// take a feature collection of features (maskFeatures), then stream in polygons
// (targetFeatures) and stream out only features that do not intersect any of
// the  maskFeatures

import es from 'event-stream';
import extent from 'geojson-extent';
import fs from 'fs';
import JSONStream from 'JSONStream';
import minimist from 'minimist';
import turf from 'turf';
import rbush from 'rbush';

const argv = minimist(process.argv.slice(2));

const maskFeaturesPath = argv['mask'];


class Index {
  constructor (maskFeatures) {
    this.tree = rbush(16);
    const loadArrays = maskFeatures.features.map((feature) => {
      return extent(feature).concat({'feature': feature});
    });
    this.tree.load(loadArrays);
  }

  intersects (feature) {
    let bbox, found;

    // get bbox matches (fast)
    if (feature.geometry.type === 'Point') {
      const coords = feature.geometry.coordinates;
      bbox = coords.concat(coords);
    } else {
      bbox = extent(feature.geometry);
    }
    const matches = this.tree.search(bbox);

    // loop through bbox matches, doing more thorough intersection test (slow)
    for (var i = 0, len = matches.length; i < len; i++) {
      const match = matches[i];
      let intersection; 
      try {
        intersection = turf.intersect(feature.geometry, match[4].feature.geometry);
      } catch (e) {
        throw `invalid topology found: ${feature.id}`;
      }

      if (intersection !== undefined) {
        return true;
      }
    }

    return false;
  }
}


fs.createReadStream(maskFeaturesPath)
  .pipe(JSONStream.parse())
  .pipe(es.writeArray((err, maskFeatures) => {
    let index;
    if(maskFeatures[0]) {
      index = new Index(maskFeatures[0]);
    }

    process.stdin
      .pipe(JSONStream.parse())
      .pipe(es.map((feature, cb) => {
        if (index && index.intersects(feature)) {
          cb();
        } else {
          cb(null, feature);
        }
      }))
      .pipe(JSONStream.stringify(false))
      .pipe(process.stdout)
      .on('error', (err) => {
        console.log(err);
      });
  }));
