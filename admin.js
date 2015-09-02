#!/usr/bin/env node
// Licensed under the Apache 2.0 License. See footer for details.

var express = require('express'),
    http = require('http'),
    path = require('path'),
    cloudant = require('cloudant'),
    program = require('commander'),
    dotenv = require('dotenv'),
    crypto = require('crypto'),
    pkg = require(path.join(__dirname, 'package.json'));

http.post = require('http-post');

dotenv.load();

var app = express();

(function(app) {
  if (process.env.VCAP_SERVICES) {
    var vcapServices = JSON.parse(process.env.VCAP_SERVICES);
    app.set('vcapServices', vcapServices);
    if (vcapServices.cloudantNoSQLDB && vcapServices.cloudantNoSQLDB.length > 0) {
      var service = vcapServices.cloudantNoSQLDB[0];
      if (service.credentials) {
        app.set('cloudant-fieldwork-db', cloudant({
          username: service.credentials.username,
          password: service.credentials.password,
          account: service.credentials.username
        }));
      }
    }
  }
})(app);

program.version(pkg.version);

program
  .command('db <method>')
  .description('Create (put) or delete the database')
  .action(function(method, options) {
    var fieldworkDb = app.get('cloudant-fieldwork-db');
    if (!fieldworkDb) {
      console.error('No database configured');
      return;
    }
    // set up CORS for web app access
    fieldworkDb.set_cors({ 
      enable_cors: true, 
      allow_credentials: true, 
      origins: [ "http://mybluemix.net","https://mybluemix.net"]
    }, 
    function(err, data) {
      console.log(err, data);
    });
    
    switch (method) {
      case 'put':
        fieldworkDb.db.create('fieldedits', function(err, body) {
          if (!err) {
            console.log('Fieldedits database created');
          } else {
            if (412 == err.statusCode) {
              console.log('Fieldedits database already exists');
            } else {
              console.error('Error creating fieldedits database');
            }
          }
        });
        break;
      case 'delete':
        fieldworkDb.db.destroy('fieldedits', function(err, body) {
          if (!err) {
            console.log('Fieldedits database deleted');
          } else {
            if (404 == err.statusCode) {
              console.log('Fieldedits database does not exist');
            } else {
              console.error('Error deleting Fieldedits database');
            }
          }
        });
        break;
    }
  }).on('--help', function() {
    console.log('  Examples:');
    console.log();
    console.log('    $ db put');
    console.log('    $ db delete');
    console.log();
  });

program
  .command('ddoc <method>')
  .description('Create (put) or delete design documents')
  .action(function(method, options) {
    var fieldworkDb = app.get('cloudant-fieldwork-db');
    if (!fieldworkDb) {
      console.error('No database configured');
      return;
    }
    var fieldeditsDb = fieldworkDb.use('fieldedits');
    switch (method) {
      case 'put':
        // TODO: Allow this to handle migrations
        var ddoc = {
          _id: '_design/SpatialView',
          "st_indexes": {
            "spatial": {
              "crs": {
                "type": "name",
                "properties": {
                  "name": "urn:ogc:def:crs:OGC:1.3:CRS84"
                }
              },
              "index": "function(doc){\n if (doc.geometry) { st_index(doc.geometry); }\n}"
            }
          }
        };
        fieldeditsDb.insert(ddoc, function(err, body) {
          if (!err) {
            console.log('Design document created');
          } else {
            if (409 == err.statusCode) {
              fieldeditsDb.get(ddoc._id, function(err, body) {
                var rev = body._rev;
                delete body._rev;
                ddocHash = crypto.createHash('md5').update(JSON.stringify(ddoc)).digest('hex');
                bodyHash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex');
                if (ddocHash != bodyHash) {
                  ddoc._rev = rev;
                  fieldeditsDb.insert(ddoc, function(err, body) {
                    if (!err) {
                      console.log('Design document updated');
                    } else {
                      console.error('Error updating design document database');
                    }
                  });
                } else {
                  console.log('Design document already exists and does not need updating');
                }
              });
            } else {
              console.error('Error creating design document database');
            }
          }
        });
        break;
      case 'delete':
        eventsDb.get('_design/SpatialView', function(err, doc) {
          if (!err) {
            eventsDb.destroy('_design/SpatialView', doc._rev, function(err, body) {
              if (!err) {
                console.log('Design document deleted');
              } else {
                if (404 == err.statusCode) {
                  console.log('Design document does not exist');
                } else {
                  console.error('Error deleting design document');
                }
              }
            });
          } else {
            if (404 == err.statusCode) {
              console.log('Design document does not exist');
            } else {
              console.error('Error getting design document');
            }
          }
        });
        break;
    }
  }).on('--help', function() {
    console.log('  Examples:');
    console.log();
    console.log('    $ ddoc put');
    console.log('    $ ddoc delete');
    console.log();
  });

program
  .command('track')
  .description('Track application deployments')
  .action(function(options) {
    var vcapApplication = app.get('vcapApplication');
    if (vcapApplication) {
      var event = {};
      if (vcapApplication.application_name) {
        event.application_name = vcapApplication.application_name;
      }
      if (vcapApplication.space_id) {
        event.space_id = vcapApplication.space_id;
      }
      if (vcapApplication.application_version) {
        event.application_version = vcapApplication.application_version;
      }
      if (vcapApplication.application_uris) {
        event.application_uris = vcapApplication.application_uris;
      }
      // TODO: Make this work over HTTPS
      http.post('http://deployment-tracker.mybluemix.net/', event);
    }
  }).on('--help', function() {
    console.log('  Examples:');
    console.log();
    console.log('    $ track');
    console.log();
  });

program.parse(process.argv);

//-------------------------------------------------------------------------------
// Copyright IBM Corp. 2015
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//-------------------------------------------------------------------------------