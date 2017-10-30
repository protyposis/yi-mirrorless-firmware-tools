'use strict';

const fs = require('fs');
const path = require('path');
const S = require('string');

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
 * Decompresses compressed data in section 0 of the firmware.
 * @param buffer
 * @returns {Buffer}
 */
function decompress(buffer) {
    let bufferByteIndex = 0;

    const readNextByte = () => {
        return buffer.readUInt8(bufferByteIndex++);
    };

    const decodeFlagByte = (flagByte) => {
        const flags = [];

        for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
            const copyByte = (flagByte >> bitIndex) & 1 === 1;
            flags.push(copyByte);
        }

        return flags;
    };

    const toBitString = (value, bits) => {
      return S(value.toString(2)).padLeft(bits, '0');
    };

    const toHexString = (value, bytes) => {
        return S(value.toString(16)).padLeft(bytes * 2, '0');
    };

    while (bufferByteIndex < buffer.length && bufferByteIndex < 100) {
        // Read the flag byte, whose bits are flags that tell which bytes are to be copied directly, and which bytes
        // are lookup information.
        const flagByte = readNextByte();
        // Parse the flag byte into a boolean flag array
        const flags = decodeFlagByte(flagByte);

        const flagsByteBinaryString = toBitString(flagByte, 8);
        const flagsString = flags.map((flag) => flag ? 'C' : 'L').reduce((a, b) => a + b);
        console.log(`${bufferByteIndex - 1} flag: 0x${toHexString(flagByte, 1)}/${flagsByteBinaryString} => ${flagsString}`
            + (flagByte === 0xFF ? ' !!!!!' : ''));

        for (let copyByte of flags) {
            if (copyByte) {
                // Just copy the byte into the output
                const byte = readNextByte();
                console.log(`${bufferByteIndex - 1} copy: 0x${byte.toString(16)}`);
            } else {
                // Read lookup data bytes (2 bytes)
                const lookup = readNextByte() << 8 | readNextByte();
                // TODO decode lookup format
                console.log(`${bufferByteIndex - 2} lookup: 0x${toHexString(lookup, 2)}/${toBitString(lookup, 16)}`);
            }
        }
    }

    // TODO return decompressed data
    return Buffer.alloc(0);
}

function decompressFile(fileName) {
    const data = fs.readFileSync(fileName);

    // Skip the two uncompressed 0x1000 byte sections
    const compressedData = data.slice(0x2000);

    const decompressData = decompress(compressedData);
}

exports.parseHeader = parseHeader;
exports.unpack = unpack;
exports.decompressFile = decompressFile;
