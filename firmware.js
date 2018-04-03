/*
 * YI Mirrorless Firmware Tools
 * Author: Mario Guggenberger <mg@protyposis.net>
 * Licensed under the GPLv3
 */
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('string');
const {versions} = require('./versions');
const lzss = require('./lzss');

const FW_SECTION_HEADER_LENGTH = 0x100;
const FW_SUBSECTION_BLOCK_SIZE = 2048;
const METADATA_FILE_EXTENSION = `.unpack`;

function parseHeader(headerString) {
    let parsedHeader = {
        sectionId: undefined,
        sectionLength: undefined,
        deviceId: undefined,
        deviceVersion: undefined,
        dvr: undefined,
        sectionSum: undefined,
        sectionOffset: undefined,
        followingSectionIds: undefined,
    };

    const parts = headerString.split(' ')
    // Remove empty items (null strings / spaces)
        .filter((part) => part !== '')
        // Remove whitespace paddings
        .map((part) => part.trim());

    // Parse the header parts into the parsedHeader structure
    parts.forEach((part, index) => {
        const isKeyValue = part.indexOf('=') !== -1;
        // The first part is a potential section Id
        if (!isKeyValue && index === 0) {
            parsedHeader.sectionId = part;
            return;
        }

        // After the potential section Id and the length follows the device Id
        if (!isKeyValue && index < 3) {
            parsedHeader.deviceId = part;
            return;
        }

        if (isKeyValue) {
            const [key, value] = part.split('=');

            switch (key) {
                case 'LENGTH':
                    parsedHeader.sectionLength = parseInt(value);
                    break;

                case 'VER':
                    parsedHeader.deviceVersion = value;
                    break;

                case 'DVR':
                    parsedHeader.dvr = value;
                    break;

                case 'SUM':
                    parsedHeader.sectionSum = parseInt(value);
                    break;

                case 'OFFSET':
                    parsedHeader.sectionOffset = parseInt(value);
                    break;
            }
        } else {
            parsedHeader.followingSectionIds = parsedHeader.followingSectionIds || [];
            parsedHeader.followingSectionIds.push(part);
        }
    });

    // Remove undefined properties
    parsedHeader = JSON.parse(JSON.stringify(parsedHeader));

    return parsedHeader;
}

function identifyVersion(header) {
    const deviceIdVersions = versions.filter(version => version[0] === header.deviceId);

    if (deviceIdVersions.length === 0) {
        throw `unknown deviceId ${header.deviceId}`;
    }

    const deviceVersions = deviceIdVersions.filter(version => version[1] === header.deviceVersion);

    if (deviceVersions.length === 0) {
        throw `unknown device version ${header.deviceVersion}`;
    }

    const dvrVersions = deviceVersions.filter(version => version[2] === header.dvr);

    if (dvrVersions.length === 0) {
        throw `unknown dvr version ${header.dvr}`;
    }

    return dvrVersions[0];
}

function calculateChecksum(buffer) {
    let sum = 0;

    for (let i = 0; i < buffer.length; i++) {
        sum += buffer.readUInt8(i);
    }

    return sum;
}

function readSections(fileName, sectionReadCallback) {
    const fd = fs.openSync(fileName, 'r');
    const headerBuffer = Buffer.alloc(FW_SECTION_HEADER_LENGTH);

    let readPosition = 0;
    let sectionCount = 0;
    let version = null;

    // Skip leading spaces until the first header starts
    // (This is necessary for the Fujifilm X-A10 which has two leading space characters)
    fs.readSync(fd, headerBuffer, 0, headerBuffer.length, readPosition);
    while (headerBuffer.readUInt8(readPosition) === 0x20) {
        readPosition++;
    }

    while (true) {
        // Read section header
        let bytesRead = fs.readSync(fd, headerBuffer, 0, headerBuffer.length, readPosition);
        readPosition += bytesRead;

        // Check for EOF if no more header was read
        if (bytesRead === 0) {
            console.log('EOF');
            return;
        }

        console.log(`----- Section ${sectionCount} -----`);

        // Parse section header
        const headerString = headerBuffer.toString('ascii').trim();
        console.log(`Raw header string: ${headerString}`);
        const header = parseHeader(headerString);
        console.log(`Parsed header:`, header);

        // Identify the firmware version after the first section head is parsed
        if (sectionCount === 0) {
            try {
                version = identifyVersion(header);
                const info =
                    '#####################################################################\n' +
                    '# Firmware version identified: $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ #\n' +
                    '#####################################################################';
                const placeholder = '$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$';
                console.info(info.replace(placeholder, S(version[3]).padRight(placeholder.length).s));
            } catch (error) {
                const warning =
                    '# WARNING ###########################################################\n' +
                    '# Cannot identify firmware: $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ #\n' +
                    '# Please open an issue to get this version added:                   #\n' +
                    '# https://github.com/protyposis/yi-mirrorless-firmware-tools/issues #\n' +
                    '#####################################################################';
                const placeholder = '$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$';
                console.warn(warning.replace(placeholder, S(error).padRight(placeholder.length).s));
            }
        }

        // Read section body
        const sectionBuffer = Buffer.alloc(header.sectionLength);
        bytesRead = fs.readSync(fd, sectionBuffer, 0, sectionBuffer.length, readPosition);
        readPosition += bytesRead;

        // Check read for completeness
        if (bytesRead < sectionBuffer.length) {
            throw `Incomplete section read: ${bytesRead} < ${sectionBuffer.length}`;
        } else {
            console.log(`Section read ok (${bytesRead} bytes)`);
        }

        // Calculate and test checksum
        const sum = calculateChecksum(sectionBuffer);

        if (sum !== header.sectionSum) {
            throw `Checksum test failed: ${sum} != ${header.sectionSum}`;
        }
        else {
            console.log(`Checksum test ok (${sum})`);
        }

        // section number, raw header, parsed header, FW version info, body data
        sectionReadCallback(sectionCount, headerString, header, version, sectionBuffer);

        sectionCount++;
    }
}

function unpack(fileName, targetDirectory) {
    const metadata = {
        version: 0,
        filename: path.basename(fileName),
        sections: [],
    };

    readSections(fileName, (sectionNumber, rawHeader, parsedHeader, version, data) => {
        // Write section to file
        const sectionFileName = path.basename(fileName)
            + `.${sectionNumber}`
            + (parsedHeader.sectionId ? `.${parsedHeader.sectionId}` : '');

        const outputSectionFileName = path.join(targetDirectory, sectionFileName);
        fs.writeFileSync(outputSectionFileName, data);
        console.log(`Output file: ${sectionFileName}`);

        const subsectionData = [];
        // Split first section into subsections
        if (sectionNumber === 0 && version) {
            unpackSection(data, (index, start, sectionData, processedSectionData, compressed) => {
                const targetFileName = path.basename(outputSectionFileName) + '.' + S(start).padLeft(8, '0');
                const targetFileNameDecompressed = targetFileName + '.decompressed';
                const targetFileNameFull = path.join(targetDirectory, targetFileName);
                const targetFileNameFullDecompressed = path.join(targetDirectory, targetFileNameDecompressed);

                if (compressed) {
                    fs.writeFileSync(targetFileNameFull, sectionData);
                    fs.writeFileSync(targetFileNameFullDecompressed, processedSectionData);
                }
                else {
                    fs.writeFileSync(targetFileNameFull, sectionData);
                }

                console.log(`Output: ${targetFileNameFull}`);

                subsectionData.push({
                    filename: targetFileName,
                    compressed: compressed,
                    filenameDecompressed: compressed ? targetFileNameDecompressed : undefined,
                })
            });
        }

        metadata.sections.push({
            filename: sectionFileName,
            rawHeader: rawHeader,
            parsedHeader: parsedHeader,
            subsections: subsectionData,
        });
    });

    const sectionDataFileName = path.basename(fileName) + METADATA_FILE_EXTENSION;
    const sectionDataFileNameFull = path.join(targetDirectory, sectionDataFileName);
    fs.writeFileSync(sectionDataFileNameFull, JSON.stringify(metadata, null, 2));

    console.log(`Wrote metadata file: ${sectionDataFileName} (required for repacking!)`);
    console.log(`Unpacking finished!`);
}

/**
 * A section ends with a zero padding and a new section starts at a 2048-byte aligned index.
 * This only works if sections are padded with enough 0x00. If a sections fits better into the 2048 byte
 * alignment, this detection fails. Also, this does not tell us if a section is compressed.
 * @param data
 * @returns {Array}
 */
function detectSectionBreaks(data) {
    let bufferByteIndex = 0;
    let zeroCount = 0;
    const sectionBreaks = [];

    while (bufferByteIndex < data.length) {
        const byte = data.readUInt8(bufferByteIndex++);

        if (byte === 0x00) {
            zeroCount++;
        } else {
            if ((bufferByteIndex - 1) % 2048 === 0 && zeroCount > 16) {
                console.log(`Section break detected at ${bufferByteIndex - 1}`);
                sectionBreaks.push(bufferByteIndex - 1);
            }

            zeroCount = 0;
        }
    }

    return sectionBreaks;
}

function buildSectionDecompressionMetadata(sectionBreaks, sectionLength) {
    const sectionDecompressionMetadata = [];

    [0, ...sectionBreaks, sectionLength].forEach((_, index, positions) => {
        if (index === 0) {
            // We skip the first entry because it does not have a predecessor
            return;
        }

        const sectionStart = positions[index - 1];
        const sectionEnd = positions[index];
        const sectionNumber = sectionDecompressionMetadata.length;
        const compressed = sectionNumber > 1;

        sectionDecompressionMetadata.push([sectionStart, sectionEnd, compressed]);
    });

    return sectionDecompressionMetadata;
}

function unpackSection(data, sectionDecompressedCallback, decompressOptions) {
    const sectionBreaks = detectSectionBreaks(data);
    const sectionDecompressionMetadata = buildSectionDecompressionMetadata(sectionBreaks, data.length);

    sectionDecompressionMetadata.forEach(([start, end, compressed], index) => {
        const sectionData = data.slice(start, end);
        let processedSectionData;
        console.log(`Section ${index}: ${start}-${end}`);

        if (compressed) {
            console.log(`Decompressing...`);
            processedSectionData = lzss.decompress(sectionData, decompressOptions);

            const stats = {
                inputSize: sectionData.length,
                outputSize: processedSectionData.length,
                compressionRate: processedSectionData.length / sectionData.length,
            };

            console.log(`Decompression finished (compression rate: ${stats.compressionRate})`);
        } else {
            processedSectionData = sectionData;
        }

        sectionDecompressedCallback(index, start, sectionData, processedSectionData, compressed);
    });
}

function prepareHeader(rawHeader) {
    // Append CR LF
    rawHeader += '\r\n';

    // Pad the header to the output header length
    rawHeader = S(rawHeader).padRight(FW_SECTION_HEADER_LENGTH).s;

    // Return as buffer
    return Buffer.from(rawHeader, 'ascii');
}

function flipRegion(fileName, targetDirectory) {
    const INT = 'M1INT';
    const CN = 'M1CN';

    let sourceRegion, targetRegion;

    const outputBuffers = [];

    readSections(fileName, (sectionNumber, rawHeader, parsedHeader, version, data) => {
        // Detect source/target regions in first section
        if (!sourceRegion) {
            if (S(rawHeader).contains(INT)) {
                sourceRegion = INT;
                targetRegion = CN;
            } else if (S(rawHeader).contains(CN)) {
                sourceRegion = CN;
                targetRegion = INT;
            } else {
                throw `Invalid region`;
            }
        }

        // Flip CN <-> INT
        let modifiedRawHeader = rawHeader.replace(sourceRegion, targetRegion);

        outputBuffers.push(prepareHeader(modifiedRawHeader));
        outputBuffers.push(data);
    });

    const targetFileBaseName = path.basename(fileName) + '.' + targetRegion;
    const targetFileName = path.join(targetDirectory, targetFileBaseName);

    fs.writeFileSync(targetFileName, Buffer.concat(outputBuffers));

    console.info(`Flipped region from ${sourceRegion} to ${targetRegion}`);
    console.info(`Modified firmware written to: ${targetFileName}`);
    console.info(`You can now rename the file '${targetFileBaseName}' to 'firmware.bin' and upload it to the camera`);
}

function test(fileName) {
    readSections(fileName, (sectionNumber, rawHeader, parsedHeader, version, data) => {
        console.log(`Section ${sectionNumber}`);

        // Split first section into subsections
        if (sectionNumber === 0 && version) {
            let decompressionLookups = [];

            unpackSection(data, (index, start, sectionData, processedSectionData, compressed) => {
                console.log(`Section ${sectionNumber}.${index}`);

                if (compressed) {
                    const compressionLookups = [];
                    let mismatchCount = 0;
                    const recompressedData = lzss.compress(processedSectionData, {
                        lookupCallback: lookupData => {
                            compressionLookups.push(lookupData);

                            const l1 = decompressionLookups[compressionLookups.length - 1];
                            const l2 = compressionLookups[compressionLookups.length - 1];

                            // Test of the lookups generated by the compression are the same as those encoded
                            // in the compressed input data
                            // No mismatches would mean that the compression yields exactly the same result as the
                            // compression of the original firmware file
                            // TODO find out why some lookups are different
                            const similar = l1.every(function (u, i) {
                                return u === l2[i];
                            });
                            if (!similar) {
                                if (mismatchCount < 50) {
                                    console.log(`lookup mismatch: ${l1} <-> ${l2}`);
                                } else if (mismatchCount === 50) {
                                    console.log(`too many mismatches, stopping logging`);
                                }
                                mismatchCount++;
                            }
                        }
                    });

                    if (mismatchCount > 0) {
                        console.log(`${mismatchCount} mismatches`);
                    }

                    const redecompressedData = lzss.decompress(recompressedData);

                    const l1 = processedSectionData.length;
                    const l2 = redecompressedData.length;

                    console.log(`Stats for decompressed -> compressed -> decompressed:`)
                    if (l1 === l2) {
                        console.log(`lengths match :)`);
                    } else {
                        console.log(`lengths do not match by ${l1 - l2} bytes`);
                    }

                    let diffByteCount = 0;
                    for (let i = 0; i < Math.min(l1, l2); i++) {
                        if (processedSectionData.readUInt8(i) !== redecompressedData.readUInt8(i)) {
                            diffByteCount++;
                        }
                    }

                    if (diffByteCount === 0) {
                        console.log(`data match :)`);
                    } else {
                        console.log(`data does not match by ${diffByteCount} bytes`);
                    }
                }

                decompressionLookups = [];
            }, {
                lookupCallback: lookupData => {
                    decompressionLookups.push(lookupData);
                }
            });
        }
    });
}

function repack(fileName, directory) {
    const metadataFileName = fileName + METADATA_FILE_EXTENSION;

    if (!fs.existsSync(metadataFileName)) {
        throw `cannot repack, metadata file not found (${metadataFileName})`;
    }

    const metadata = JSON.parse(fs.readFileSync(metadataFileName, 'utf8'));
    const repackedFileName = fileName + `.repacked`;
    const outputBuffers = [];

    metadata.sections.forEach(sectionMetadata => {
        const sectionFileName = path.join(directory, sectionMetadata.filename);
        let sectionData = [];

        if (sectionMetadata.subsections && sectionMetadata.subsections.length > 0) {
            const subsectionBuffers = [];

            sectionMetadata.subsections.forEach(subsectionMetadata => {
                let subsectionData;

                if (subsectionMetadata.compressed) {
                    const subsectionFileName = path.join(directory, subsectionMetadata.filenameDecompressed);
                    console.log(`Reading ${subsectionFileName}`);
                    subsectionData = fs.readFileSync(subsectionFileName);
                    console.log(`Compressing...`);
                    subsectionData = lzss.compress(subsectionData);
                } else {
                    const subsectionFileName = path.join(directory, subsectionMetadata.filename);
                    console.log(`Reading ${subsectionFileName}`);
                    subsectionData = fs.readFileSync(subsectionFileName);
                }
                subsectionBuffers.push(subsectionData);

                // pad subsection with zeros to block size
                const subsectionDataLength = subsectionData.length;
                const requiredPadding = (FW_SUBSECTION_BLOCK_SIZE - (subsectionDataLength % FW_SUBSECTION_BLOCK_SIZE)) % FW_SUBSECTION_BLOCK_SIZE;
                subsectionBuffers.push(Buffer.alloc(requiredPadding));
            });

            sectionData = Buffer.concat(subsectionBuffers);
        } else {
            console.log(`Reading ${sectionFileName}`);
            sectionData = fs.readFileSync(sectionFileName);
        }

        // update header
        let header = sectionMetadata.rawHeader;
        header = header.replace(`${sectionMetadata.parsedHeader.sectionLength}`, `${sectionData.length}`);
        const checksum = calculateChecksum(sectionData);
        header = header.replace(`${sectionMetadata.parsedHeader.sectionSum}`, `${checksum}`);
        const headerData = prepareHeader(header);

        outputBuffers.push(headerData);
        outputBuffers.push(sectionData);
    });

    const outputBuffer = Buffer.concat(outputBuffers);

    console.log(`Writing ${repackedFileName}`);
    fs.writeFileSync(repackedFileName, outputBuffer);

    const warning =
        '# WARNING ###########################################################\n' +
        '# Do not flash this firmware unless you know exactly what you are   #\n' +
        '# doing! This is not tested and will most likely destroy your       #\n' +
        '# camera!                                                           #\n' +
        '#####################################################################';
    console.warn(warning);

    console.log(`Finished!`);
}

exports.unpack = unpack;
exports.flipRegion = flipRegion;
exports.test = test;
exports.repack = repack;
