/* jshint node: true, bitwise: true, curly: true, eqeqeq: true, forin: true, freeze: true, immed: true, indent: 4, latedef: true, newcap: true, noarg: true, noempty: true, nonbsp: true, nonew: true, quotmark: double, undef: true, unused: true, strict: true, trailing: true */

"use strict";

// Initialize variables
var fs = require("fs");
var path = require("path");
var artificialPrecision = 0;

function create(options, directory) {
  var log = options.log;
  if (options.TEST_CREATE_UNIQUE_DIRECTORY) {
    directory = path.resolve(__dirname, Date.now().toString());
  }

  // Maps a file name to a fully-qualified local path
  function mapFileName(fileName, callback) {
    // Helper function to validate a file name
    var validateMappedFileName = function(callback) {
      // Map name to data directory
      var mappedFileName = path.resolve(directory, fileName);
      // Verify canonicalized location is correct
      if (path.dirname(mappedFileName) === directory) {
        callback(mappedFileName);
      } else {
        callback(null);
      }
    };

    if (fileName) {
      // If data directory exists...
      fs.exists(directory, function(exists) {
        if (exists) {
          // ... validate the file
          validateMappedFileName(callback);
        } else {
          // ... create the data directory...
          fs.mkdir(directory, function(err) {
            if (err) {
              callback(null);
            } else {
              // ... then validate the file
              validateMappedFileName(callback);
            }
          });
        }
      });
    } else {
      callback(null);
    }
  }

  // Backs up a file
  function backupFile(mappedFileName, callback) {
    fs.exists(mappedFileName, function(exists) {
      if (exists) {
        if (options.BACKUP_FILE) {
          // Get modified time
          fs.stat(mappedFileName, function(err, stats) {
            if (err) {
              callback(err);
            } else {
              // Create unique backup file name
              var backupFileName = mappedFileName + "." + stats.mtime.getTime() + "-" + artificialPrecision++;
              fs.exists(backupFileName, function(exists) {
                if (exists) {
                  // Delete existing backup file...
                  fs.unlink(backupFileName, function(err) {
                    if (err) {
                      callback(err);
                    } else {
                      // ... and rename to backup
                      fs.rename(mappedFileName, backupFileName, callback);
                    }
                  });
                } else {
                  // Rename to backup
                  fs.rename(mappedFileName, backupFileName, callback);
                }
              });
            }
          });
        } else {
          // Not backing up files, so just delete
          fs.unlink(mappedFileName, callback);
        }
      } else {
        callback();
      }
    });
  }

  // Write file
  function writeFile(req, res) {
    // Helper function to handle the end/error of a stream
    var handleEndAndError = function(stream, res) {
      stream
        .on("end", function() {
          if (!res.finished) {
            res.status(200).send("");
          }
        })
        .on("error", function() {
          if (!res.finished) {
            res.sendStatus(500);
          }
        });
    };
    // Helper function to write to a file
    var writeStream = function(mappedFileName) {
      log("Writing: " + mappedFileName);
      backupFile(mappedFileName, function(err) {
        if (err) {
          res.sendStatus(500);
        } else {
          // Create stream and pipe incoming content to it
          var fileStream = fs.createWriteStream(mappedFileName);
          var inStream = req.content || req;
          handleEndAndError(fileStream, res);
          handleEndAndError(inStream, res);
          inStream.pipe(fileStream);
        }
      });
    };
    // Function body
    mapFileName(req.query.name, function(mappedFileName) {
      if (mappedFileName) {
        if (options.BLOCK_NEW && !(options.TEST_ALLOW_BYPASS_BLOCK_NEW && req.query.bypass)) {
          // Blocking new files, so look for previous file to replace
          mapFileName(req.query.previousName || "placeholder", function(mappedPreviousFileName) {
            if (mappedPreviousFileName) {
              fs.exists(mappedFileName, function(exists) {
                fs.exists(mappedPreviousFileName, function(previousExists) {
                  // If file doesn't already exist and no previous file provided or it doesn't exist...
                  if (!exists && (!req.query.previousName || !previousExists)) {
                    // Fail
                    res.sendStatus(500);
                  } else {
                    // Backup and write to file
                    backupFile(mappedPreviousFileName, function(err) {
                      if (err) {
                        res.sendStatus(500);
                      } else {
                        writeStream(mappedFileName);
                      }
                    });
                  }
                });
              });
            } else {
              res.sendStatus(500);
            }
          });
        } else {
          // Not blocking new files; just write
          writeStream(mappedFileName);
        }
      } else {
        res.sendStatus(500);
      }
    });
  }

  // Lists files
  function listFiles(req, res) {
    // Get data directory
    mapFileName("placeholder", function(mappedFileName) {
      var dir = path.dirname(mappedFileName);
      log("Listing: " + dir);
      // Read directory
      fs.readdir(dir, function(err, files) {
        if (err) {
          res.sendStatus(500);
        } else {
          if (!(options.TEST_ALLOW_LIST_INCLUDE_BACKUPS && req.query.backups)) {
            // Filter out backup files
            var hiddenFilesRegex = /\.\d\d\d\d\d\d\d\d\d\d\d\d\d-\d+$/;
            files = files.filter(function(file) {
              return !hiddenFilesRegex.test(file);
            });
          }
          // Add trailing newline and send list
          files.push("");
          res.status(200).send(files.join("\r\n"));
        }
      });
    });
  }

  // Read file
  function readFile(req, res) {
    mapFileName(req.query.name, function(mappedFileName) {
      if (mappedFileName) {
        log("Reading: " + mappedFileName);
        res.sendFile(mappedFileName, function(err) {
          if (err) {
            res.sendStatus(500);
          }
        });
      } else {
        res.sendStatus(500);
      }
    });
  }

  // Delete file
  function deleteFile(req, res) {
    mapFileName(req.query.name, function(mappedFileName) {
      if (mappedFileName) {
        log("Deleting: " + mappedFileName);
        fs.exists(mappedFileName, function(exists) {
          if (exists) {
            // Backup implicitly deletes
            backupFile(mappedFileName, function(err) {
              if (err) {
                res.sendStatus(500);
              } else {
                res.status(200).send("");
              }
            });
          } else {
            res.sendStatus(500);
          }
        });
      } else {
        res.sendStatus(500);
      }
    });
  }

  // Return implementation
  return {
    deleteFile: deleteFile,
    listFiles: listFiles,
    readFile: readFile,
    writeFile: writeFile
  };
}

module.exports = create;
