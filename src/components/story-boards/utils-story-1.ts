import { readCSVFile } from "./utils-data";
import { SemanticEvent } from "./SemanticEvent";
import { detectFeatures } from "./utils-feature-detection";
import {
  combineBounds,
  eventsToGaussian,
  findDateIdx,
  maxBounds,
  peakSegment,
  splitDataAndEvents,
} from "./utils-aggregation-segmentation";

import { GraphAnnotation } from "./GraphAnnotation";
import { DataEvent } from "./DataEvent";
import { TimeSeries } from "./TimeSeries";
import { ITimeSeriesData } from "src/models/ITimeSeriesData";

/*********************************************************************************************************
 * - Prepare data
 *********************************************************************************************************/

const dataAllRegions: { [key: string]: ITimeSeriesData[] } = {};
let semanticEvents = [];
const peaksAllRegion = {};
const gaussAllRegion = {};

/*
 * Load data
 */
export async function loadData(): Promise<void> {
  await prepareDataForAllRegion();
  prepareSemanticEvents();
  computePeaks();
  computeGauss();
}

/*
 * Return all area/region names sorted.
 */
export function getRegions(): string[] {
  return Object.keys(dataAllRegions).sort();
}

async function prepareDataForAllRegion() {
  const csv: any[] = await readCSVFile(
    "/static/story-boards/newCasesByPublishDateRollingSum.csv",
  );

  csv.forEach((row) => {
    const region = row.areaName;
    const date = new Date(row.date);
    const cases = +row.newCasesByPublishDateRollingSum;

    if (!dataAllRegions[region]) dataAllRegions[region] = [];

    dataAllRegions[region].push({ date: date, y: cases });
  });

  for (const region in dataAllRegions) {
    dataAllRegions[region].sort((e1, e2) => e1.date - e2.date);
  }

  // prettier-ignore
  // console.log("prepareDataForAllRegion: dataForAllRegions = ", dataForAllRegions);
}

function prepareSemanticEvents() {
  // We need to construct Calendar Data Because
  // Lockdown events
  const lockdownStart1 = new SemanticEvent(new Date("2020-03-24"))
    .setType(SemanticEvent.TYPES.LOCKDOWN_START)
    .setDescription("Start of First Lockdown.");
  const lockdownStart2 = new SemanticEvent(new Date("2021-01-05"))
    .setType(SemanticEvent.TYPES.LOCKDOWN_END)
    .setDescription("Start of Second Lockdown.");
  const lockdownEnd1 = new SemanticEvent(new Date("2020-05-28"))
    .setType(SemanticEvent.TYPES.LOCKDOWN_START)
    .setDescription("End of First Lockdown.");
  const lockdownEnd2 = new SemanticEvent(new Date("2021-04-01"))
    .setType(SemanticEvent.TYPES.LOCKDOWN_END)
    .setDescription("End of Second Lockdown.");

  // Vaccine Events
  const pfizer1 = new SemanticEvent(new Date("2020-12-08"))
    .setType(SemanticEvent.TYPES.VACCINE)
    .setDescription("UK begins rollout of Pfizer Vaccine.");
  const astra1 = new SemanticEvent(new Date("2021-01-04"))
    .setType(SemanticEvent.TYPES.VACCINE)
    .setDescription(
      "Astrazeneca Vaccine approved and begins being administered.",
    );
  const moderna1 = new SemanticEvent(new Date("2021-04-13"))
    .setType(SemanticEvent.TYPES.VACCINE)
    .setDescription("Moderna Vaccine rollout begins in the UK.");
  const booster = new SemanticEvent(new Date("2021-09-16"))
    .setType(SemanticEvent.TYPES.VACCINE)
    .setDescription("Booster campaign in the UK starts.");

  // Create an array of semantic events and return
  semanticEvents = [
    lockdownStart1,
    lockdownEnd1,
    lockdownStart2,
    lockdownEnd2,
    pfizer1,
    astra1,
    moderna1,
    booster,
  ];

  const ranking = {};
  ranking[SemanticEvent.TYPES.LOCKDOWN_START] = 5;
  ranking[SemanticEvent.TYPES.VACCINE] = 4;
  ranking[SemanticEvent.TYPES.LOCKDOWN_END] = 3;

  semanticEvents.forEach((e) => e.setRank(ranking[e.type]));

  // prettier-ignore
  console.log("prepareSemanticEvents: semanticEvents = ", semanticEvents);
}

function computePeaks() {
  for (const region in dataAllRegions) {
    peaksAllRegion[region] = detectFeatures(dataAllRegions[region], {
      peaks: true,
      metric: "Daily Cases",
    });
  }

  console.log("computePeaks: peaksAllRegion = ", peaksAllRegion);

  const rankPeaks = (peaks) => {
    const sorted = [...peaks].sort((p1, p2) => p1.height - p2.height);
    const nPeaks = peaks.length;
    const fifth = nPeaks / 5;

    sorted.forEach((p, i) => p.setRank(1 + Math.floor(i / fifth)));
  };

  // for each region we apply the ranking function to the peak events
  for (const region in peaksAllRegion) {
    rankPeaks(peaksAllRegion[region]);
  }

  console.log("computePeaks: ranked peaksAllRegion = ", peaksAllRegion);
}

function computeGauss() {
  for (const region in peaksAllRegion) {
    const peaks = peaksAllRegion[region];
    const dailyCases = dataAllRegions[region];

    // Calculate gaussian time series for peaks
    const peaksGauss = eventsToGaussian(peaks, dailyCases);
    const peaksBounds = maxBounds(peaksGauss);

    // console.log("createGaussByRegion: peaksBounds = ", peaksBounds);

    // Calculate gaussian time series for calendar events
    const calGauss = eventsToGaussian(semanticEvents, dailyCases);
    const calBounds = maxBounds(calGauss);

    // Combine gaussian time series
    const combGauss = combineBounds([peaksBounds, calBounds]);
    gaussAllRegion[region] = combGauss;
  }

  // prettier-ignore
  console.log("computeGauss: gaussAllRegion = ", gaussAllRegion, Object.keys(gaussAllRegion));
}

/*********************************************************************************************************
 * - Filter/select region or area
 * - Segmentation value
 *********************************************************************************************************/

const splitsByRegion = {};
let segment: number;
let region: string;
let dataSelectedRegion: ITimeSeriesData[];
const annotations: { start?: number; end: number }[] = [{ start: 0, end: 0 }];

export function filterData(_region: string, _segment: number) {
  region = _region;
  segment = _segment;

  segmentData();

  dataSelectedRegion = dataAllRegions[region];
  console.log("filterData: dataForAllRegions", dataAllRegions);
  console.log("filterData: dataForSelectedRegion", dataSelectedRegion);

  calculateAnnotations();
}

function segmentData() {
  for (const region in peaksAllRegion) {
    const dailyCases = dataAllRegions[region];
    splitsByRegion[region] = peakSegment(
      gaussAllRegion[region],
      dailyCases,
    ).slice(0, segment - 1);
  }

  // prettier-ignore
  console.log("segmentData: splitsByRegion = ", splitsByRegion);
}

function calculateAnnotations() {
  console.log("calculateAnnotations: region =  ", region);

  // We now combine the event arrays and segment them based on our splits
  console.log("calculateAnnotations: peaksByRegion", peaksAllRegion);
  const peaks = peaksAllRegion[region];
  console.log("calculateAnnotations: peaks", peaks);
  const events = peaks.concat(semanticEvents);
  const splits = splitsByRegion[region].sort((s1, s2) => s1.date - s2.date);

  // Segment data and events according to the splits
  const dataEventsBySegment = splitDataAndEvents(
    events,
    splits,
    dataSelectedRegion,
  );

  // Loop over all segments and apply feature-action rules
  // let annotations = [{ start: 0, end: 0 }];
  let currSeg = 0;
  let currData, firstDate, lastDate;
  for (; currSeg < segment; currSeg++) {
    // Get segment data based on segment number
    currData = dataEventsBySegment[currSeg];
    firstDate = currData[0].date;
    lastDate = currData[currData.length - 1].date;

    // Apply different rules for first, middle and last segment
    if (currSeg == 0) {
      /*
          ------- First Segment Rules -------
        */

      /*
          ------- Rules based on entire segment -------
        */

      // Add annotation for positive line of best fit
      const slope = linRegGrad(currData.map((d) => d.y)) as number;
      const posGrad = slope > 0;
      if (posGrad)
        annotations.push(
          writeText(
            "The number of cases continues to grow.",
            firstDate,
            dataSelectedRegion,
          ),
        );

      // Add annotation based on gradient of line of best fit
      let gradText = "";
      if (Math.abs(slope) >= 0.25) {
        // Steep case
        gradText =
          `By ${lastDate.toLocaleDateString()}, the number of cases ` +
          (posGrad
            ? "continued to climb higher."
            : "continued to come down noticeably.");
        annotations.push(writeText(gradText, lastDate, dataSelectedRegion));
      } else if (Math.abs(slope) >= 0.05) {
        // Shallow case
        gradText =
          `By ${lastDate.toLocaleDateString()}, the number of cases continued to ` +
          (posGrad ? "increase." : "decrease.");
        annotations.push(writeText(gradText, lastDate, dataSelectedRegion));
      }

      /*
          ------- Rules based on datapoints in segment -------
        */

      // Set up variables for tracking highest peak and first non-zero value
      let highestPeak;
      let foundNonZero = false;
      currData.forEach((d) => {
        // Add annotation for the first non-zero value
        if (!foundNonZero && d.y > 0) {
          const nonZeroText = `On ${d.date.toLocaleDateString()}, ${region} recorded its first COVID-19 case.`;
          annotations.push(writeText(nonZeroText, d.date, dataSelectedRegion));
          foundNonZero = true;
        }

        d.events.forEach((e) => {
          // Add annotation for semantic events that are rank > 3
          if (e.rank > 3 && e instanceof SemanticEvent) {
            annotations.push(
              // @ts-expect-error -- fix accessing protected _date
              writeText(e.description, e._date, dataSelectedRegion, true),
            );
          }

          // Find tallest peak that is ranked > 3
          if (e.rank > 3 && e.type == DataEvent.TYPES.PEAK) {
            highestPeak =
              highestPeak && highestPeak.height > e.height ? highestPeak : e;
          }
        });
      });

      // Add annotation if we have a tall enough peak
      if (highestPeak) {
        const peakText = `By ${highestPeak.date}, the number of cases reached ${highestPeak.height}.`;
        annotations.push(
          writeText(peakText, highestPeak._date, dataSelectedRegion),
        );
      }
    } else if (currSeg < segment - 1) {
      /*
          ------- Middle Segments Rules -------
        */

      /*
          ------- Rules based on datapoints in segment -------
        */
      currData.forEach((d) => {
        d.events.forEach((e) => {
          // Add annotation for semantic events that are rank > 3
          if (e.rank > 3 && e instanceof SemanticEvent) {
            annotations.push(
              // @ts-expect-error -- fix accessing protected _date
              writeText(e.description, e._date, dataSelectedRegion, true),
            );
          }

          // Add annotation for peak events that are rank > 3
          if (e.rank > 3 && e.type == DataEvent.TYPES.PEAK) {
            const peakText = `By ${e.date}, the number of cases peaks at ${e.height}.`;
            annotations.push(
              writeText(peakText, e._date, dataSelectedRegion, true),
            );
          }
        });
      });
    } else {
      /*
          ------- Last Segment Rules -------
        */

      /*
          ------- Rules based entire segment -------
        */

      // Add annotation based on gradient of line of best fit
      let gradText = "";
      const slope = linRegGrad(currData.map((d) => d.y));
      if (slope >= 0.25) {
        // Steep case
        gradText = `By ${lastDate.toLocaleDateString()}, the number of cases continued to climb higher.
                      Let us all make a great effort to help bring the number down. Be safe, and support the NHS.`;
      } else if (slope >= 0.05) {
        // Shallow case
        gradText = `By ${lastDate.toLocaleDateString()}, the number of cases continued to increase.
                      Let us continue to help bring the number down. Be safe, and support the NHS.`;
      } else if (slope > -0.05) {
        // Flat case
        const cases = dataSelectedRegion[dataSelectedRegion.length - 1].y;

        // Add annotation based on final case number
        if (cases >= 200) {
          gradText = `The number of cases remains very high. Let us be safe, and support the NHS.`;
        } else if (cases >= 50) {
          gradText = `The number of cases remains noticeable. Let us be safe and support the NHS.`;
        } else {
          gradText = `The number of cases remains low. We should continue to be vigilant.`;
        }
      } else if (slope > -0.25) {
        // Negative shallow case
        gradText = `By ${lastDate.toLocaleDateString()}, the number of cases continued to decrease.
                      The trend is encouraging. Let us be vigilant, and support the NHS.`;
      } else {
        // Negative steep case
        gradText = `By ${lastDate.toLocaleDateString()}, the number of cases continued to come down noticeably.
                      We should continue to be vigilant.`;
      }
      annotations.push(writeText(gradText, lastDate, dataSelectedRegion));

      /*
          ------- Rules based on datapoints in segement -------
        */
      currData.forEach((d) => {
        d.events.forEach((e) => {
          // Add annotation for semantic events that are rank > 3
          if (e.rank > 3 && e instanceof SemanticEvent) {
            annotations.push(
              // @ts-expect-error -- fix accessing protected _date
              writeText(e.description, e._date, dataSelectedRegion, true),
            );
          }

          // Add annotation for peak events that are rank > 3
          if (e.rank > 3 && e.type == DataEvent.TYPES.PEAK) {
            const peakText = `By ${e.date}, the number of cases peaks at ${e.height}.`;
            annotations.push(
              writeText(peakText, e._date, dataSelectedRegion, true),
            );
          }
        });
      });
    }
  }

  // Sort annotations and set annotations starts to the end of the previous annotation
  annotations.sort((a1, a2) => a1.end - a2.end);
  annotations.push({ end: dataSelectedRegion.length - 1 });
  annotations.slice(1).forEach((anno, i) => (anno.start = annotations[i].end));

  console.log("calculateAnnotations: annotations", annotations);
}

/*
    Linear regression function inspired by the answer found at: https://stackoverflow.com/a/31566791.
    We remove the need for array x as we assum y data is equally spaced and we only want the gradient.
 */

function linRegGrad(y) {
  let slope = {};
  const n = y.length;
  let sum_x = 0;
  let sum_y = 0;
  let sum_xy = 0;
  let sum_xx = 0;

  for (let i = 0; i < y.length; i++) {
    sum_x += i;
    sum_y += y[i];
    sum_xy += i * y[i];
    sum_xx += i * i;
  }

  slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x);
  return slope;
}

function writeText(text, date, data, showRedCircle = false) {
  // Find idx of event in data and set location of the annotation in opposite half of graph
  const idx = findDateIdx(date, data);

  const target = data[idx];

  const anno = new GraphAnnotation()
    .title(date.toLocaleDateString())
    .label(text)
    .backgroundColor("#EEE")
    .wrap(500);

  // @ts-expect-error -- investigate
  anno.left = idx < data.length / 2;
  anno.unscaledTarget = [target.date, target.y];

  if (showRedCircle) {
    anno.circleHighlight();
  }

  return { end: idx, annotation: anno, fadeout: true };
}

/*********************************************************************************************************
 * - Create or init TimeSeries.
 * - Animate when button is clicked.
 *********************************************************************************************************/

let ts;

export function createTimeSeries(selector: string) {
  ts = new TimeSeries(dataSelectedRegion, selector, 1200, 400)
    // .svg(visCtx)
    .title(`Basic story of COVID-19 in ${region}`)
    .yLabel("Cases per Day")
    .annoTop()
    .ticks(30);

  const xSc = ts.getXScale();
  const ySc = ts.getYScale();

  let annoObj;

  console.log("createTimeSeries: annotations = ", annotations);

  annotations.forEach((a: any) => {
    annoObj = a.annotation;
    if (annoObj) {
      annoObj.x(xSc(annoObj.unscaledTarget[0])).y(ts._height / 2);

      annoObj.target(
        xSc(annoObj.unscaledTarget[0]),
        ySc(annoObj.unscaledTarget[1]),
        true,
        { left: annoObj.left, right: !annoObj.left },
      );
    }
  });

  console.log("createTimeSeries: annoObj = ", annoObj);
}

export function animateTimeSeries(animationCounter: number) {
  ts.animate(annotations, animationCounter).plot();
}
