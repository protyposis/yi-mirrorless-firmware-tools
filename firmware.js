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
const {decompress, compress} = require('./lzss');

const FW_SECTION_HEADER_LENGTH = 0x100;

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
                console.info(`Firmware version identified: ${version[3]}`);
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
        let sum = 0;
        for (let i = 0; i < sectionBuffer.length; i++) {
            sum += sectionBuffer.readUInt8(i);
        }

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
    readSections(fileName, (sectionNumber, rawHeader, parsedHeader, version, data) => {
        // Write section to file
        const sectionFileName = path.basename(fileName)
            + `.${sectionNumber}`
            + (parsedHeader.sectionId ? `.${parsedHeader.sectionId}` : '');

        const outputSectionFileName = path.join(targetDirectory, sectionFileName);
        fs.writeFileSync(outputSectionFileName, data);
        console.log(`Output file: ${sectionFileName}`);

        // Slip first section into subsections
        if (sectionNumber === 0 && version) {
            const sectionBreaks = detectSectionBreaks(data);
            const sectionDecompressionMetadata = buildSectionDecompressionMetadata(sectionBreaks, data.length);
            decompressFile(sectionDecompressionMetadata, outputSectionFileName, targetDirectory);
        }
    });
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

function decompressFile(sections, fileName, targetDirectory) {
    const data = fs.readFileSync(fileName);

    sections.forEach(([start, end, compressed], index) => {
        if (end === -1) {
            end = data.length;
        }

        const sectionData = data.slice(start, end);
        const targetFileName = path.basename(fileName) + '.' + S(start).padLeft(8, '0');
        let targetFileNameFull = path.join(targetDirectory, targetFileName);

        console.log(`Section ${index}: ${start}-${end}`);

        if (compressed) {
            console.log(`Decompressing...`);
            const decompressedData = decompress(sectionData);
            fs.writeFileSync(targetFileNameFull, sectionData);
            targetFileNameFull += '.decompressed';
            fs.writeFileSync(targetFileNameFull, decompressedData);

            const stats = {
                inputSize: sectionData.length,
                outputSize: decompressedData.length,
                compressionRate: decompressedData.length / sectionData.length,
                outputFile: targetFileNameFull,
            };

            console.log(`Decompression finished (compression rate: ${stats.compressionRate})`);
        } else {
            fs.writeFileSync(targetFileNameFull, sectionData);
        }

        console.log(`Output: ${targetFileNameFull}`);
    });
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

        // Append CR LF
        modifiedRawHeader += '\r\n';

        // Pad the header to the output header length
        modifiedRawHeader = S(modifiedRawHeader).padRight(FW_SECTION_HEADER_LENGTH).s;

        outputBuffers.push(Buffer.from(modifiedRawHeader, 'ascii'));
        outputBuffers.push(data);
    });

    const targetFileBaseName = path.basename(fileName) + '.' + targetRegion;
    const targetFileName = path.join(targetDirectory, targetFileBaseName);

    fs.writeFileSync(targetFileName, Buffer.concat(outputBuffers));

    console.info(`Flipped region from ${sourceRegion} to ${targetRegion}`);
    console.info(`Modified firmware written to: ${targetFileName}`);
    console.info(`You can now rename the file '${targetFileBaseName}' to 'firmware.bin' and upload it to the camera`);
}

exports.unpack = unpack;
exports.flipRegion = flipRegion;
