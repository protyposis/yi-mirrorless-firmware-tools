'use strict';

const fs = require('fs');
const path = require('path');

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

function unpack(fileName, targetDirectory) {
    const fd = fs.openSync(fileName, 'r');
    const headerBuffer = Buffer.alloc(FW_SECTION_HEADER_LENGTH);

    let readPosition = 0;
    let sectionCount = 0;

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

        // Write section to file
        const sectionFileName = path.basename(fileName)
            + `.${sectionCount}`
            + (header.sectionId ? `.${header.sectionId}` : '');

        fs.writeFileSync(path.join(targetDirectory, sectionFileName), sectionBuffer);
        console.log(`Output file: ${sectionFileName}`);

        sectionCount++;
    }
}

/**
 * Extracts strings from section 0
 * @param buffer
 */
function extractStrings(buffer) {
    const string = [];
    let stringIndex = 0;

    for (let i = 0; i < buffer.length; i++) {
        const byte = buffer.readUInt8(i);

        if (byte >= 32 && byte <= 126) {
            if (string.length === 0) {
                stringIndex = i;
            }

            string.push(byte);
        } else if (string.length > 0 && byte === 0xFF) {
            // String continuation length indicator byte
            // just skip over and continue reading for now
            // Some byte indicators might be:
            // 0xFF = 8 chars
            // 0x7F = 7 chars
            // 0xBF = 6 chars
            // 0xEF = 4 chars
            // 0xF7 = 3 chars
            // 0xE7 = 3 chars too?
            // 0x73 = 2 chars
            // 0xF9 = 1 char
        } else {
            if (string.length > 8) {
                console.log(stringIndex, new Buffer(string).toString('ascii'));
            }
            string.length = 0;
        }
    }
}

function printStrings(fileName) {
    const data = fs.readFileSync(fileName);
    extractStrings(data);
}

exports.parseHeader = parseHeader;
exports.unpack = unpack;
exports.extractStrings = extractStrings;
exports.printStrings = printStrings;
