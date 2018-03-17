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

class RingBuffer {
    constructor(bufferOrSize, initialIndex = 0) {
        if (typeof bufferOrSize === 'number') {
            this.buffer = Buffer.alloc(bufferOrSize);
        } else if (bufferOrSize instanceof Buffer) {
            this.buffer = bufferOrSize;
        } else {
            throw 'Unsupported input: ' + bufferOrSize;
        }
        this.bufferIndex = initialIndex;
    }

    get length() {
        return this.buffer.length;
    }

    get innerBuffer() {
        return this.buffer;
    }

    get index() {
        return this.bufferIndex;
    }

    readUInt8(offset) {
        return this.buffer.readUInt8(offset % this.buffer.length);
    }

    appendUInt8(value) {
        this.buffer.writeUInt8(value, this.bufferIndex);
        this.bufferIndex = ++this.bufferIndex % this.buffer.length;
    }

    toString(encoding) {
        return this.buffer.toString(encoding, this.bufferIndex, this.buffer.length)
            + this.buffer.toString(encoding, 0, this.bufferIndex);
    }

    getSequentialBuffer() {
        return Buffer.concat([
            this.buffer.slice(this.bufferIndex, this.buffer.length),
            this.buffer.slice(0, this.bufferIndex),
        ]);
    }

    find(byteArray) {
        const check = (x) => {
            for (let y = 1; y < byteArray.length; y++) {
                if (this.buffer.readUInt8((x + y) % this.buffer.length) !== byteArray[y]) {
                    return false;
                }
            }

            return true;
        };

        for (let x = 0; x < this.buffer.length; x++) {
            // Check the first value and if it matched, check all remaining ones
            if (this.buffer.readUInt8(x) === byteArray[0] && check(x)) {
                return x;
            }
        }

        return -1;
    }
}

/**
 * Decompresses compressed data in section 0 of the firmware.
 * @param buffer
 * @returns {Buffer}
 */
function decompress(buffer, lookupBufferOffset) {
    const LOOKUP_BUFFER_SIZE = 0x1000;
    const VERBOSE = false;

    let bufferByteIndex = 0;
    const lookupBuffer = new RingBuffer(LOOKUP_BUFFER_SIZE, (LOOKUP_BUFFER_SIZE + lookupBufferOffset) % LOOKUP_BUFFER_SIZE);
    const outputBuffer = Buffer.alloc(buffer.length * 10); // the compression is probably way less effective so lets just hope this size is enough (else we have to implement dynamic resizing)
    let outputBufferByteIndex = 0;

    const readNextByte = () => {
        return buffer.readUInt8(bufferByteIndex++);
    };

    const writeNextByte = (value) => {
        if (outputBufferByteIndex === outputBuffer.length) {
            throw 'Output buffer is full, cannot write more data';
        }

        outputBuffer.writeUInt8(value, outputBufferByteIndex++);
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
        return S(value.toString(16)).padLeft(bytes * 2, '0').toString().toUpperCase();
    };

    while (bufferByteIndex < buffer.length) {
        // Read the flag byte, whose bits are flags that tell which bytes are to be copied directly, and which bytes
        // are lookup information.
        const flagByte = readNextByte();

        // Detect end of section
        // All sections are padded to 2048 byte chunks with 0x00
        // A 0x00 flag byte with 8 zero lookups is highly unlikely, so we use that for now to detect the section end
        // If a section fits better into the 2048 byte alignment, this detection fails
        // TODO find out how we can determine the actual end (where the length of a section is stored)
        if (flagByte === 0x00) {
            const oldBufferByteIndex = bufferByteIndex;
            let zeroCount = 0;

            for (let x = 0; x < 16; x++) {
                if (readNextByte() === 0x00) {
                    zeroCount++;
                } else {
                    break;
                }
            }

            if (zeroCount === 16) {
                console.log(`Section end detected at ${bufferByteIndex - 9}`);
                break;
            }

            // End has not been detected, so restore the old buffer index and continue processing the data
            bufferByteIndex = oldBufferByteIndex;
        }

        // Parse the flag byte into a boolean flag array
        const flags = decodeFlagByte(flagByte);

        if (VERBOSE) {
            const flagsByteBinaryString = toBitString(flagByte, 8);
            const flagsString = flags.map((flag) => flag ? 'C' : 'L').reduce((a, b) => a + b);
            console.log(`${bufferByteIndex - 1} flag: 0x${toHexString(flagByte, 1)}/${flagsByteBinaryString} => ${flagsString}`
                + (flagByte === 0xFF ? ' !!!!!' : ''));
        }

        for (let copyByte of flags) {
            if (copyByte) {
                // Just copy the byte into the output
                const byte = readNextByte();

                if (VERBOSE) {
                    console.log(`${bufferByteIndex - 1} copy: 0x${byte.toString(16)}`);
                }

                // Write byte into output and lookup buffer
                writeNextByte(byte);
                lookupBuffer.appendUInt8(byte);
            } else {
                // Read lookup data bytes (2 bytes)
                const lookup1 = readNextByte();
                const lookup2 = readNextByte();
                const lookup = lookup1 << 8 | lookup2;

                // length is 4 bits, index 12 bits
                // The bytes are ordered big endian
                const lookupIndex = lookup1 | ((lookup2 & 0xF0) << 4);
                const lookupLength = (lookup2 & 0x0F) + 3;

                if (VERBOSE) {
                    console.log(`${bufferByteIndex - 2} lookup: 0x${toHexString(lookup, 2)}/${toBitString(lookup, 16)}`
                        + ` => ${toBitString(lookupIndex, 12)} ${toBitString(lookupLength - 3, 4)}`
                        + ` => ${lookupLength}@${lookupIndex}`);
                }

                // Read bytes from lookup buffer
                const lookupBytes = [];
                for (let x = 0; x < lookupLength; x++) {
                    let bufferByte = lookupBuffer.readUInt8(lookupIndex + x);
                    lookupBytes.push(bufferByte);

                    // Write bytes into output and lookup buffer
                    // The lookup buffer must be written instantly (not after the lookup is read)
                    lookupBuffer.appendUInt8(bufferByte);
                    writeNextByte(bufferByte);
                }
            }
        }
    }

    return outputBuffer.slice(0, outputBufferByteIndex);
}

function compress(buffer, lookupBufferOffset) {
    const LOOKUP_BUFFER_SIZE = 0x1000;

    let bufferByteIndex = 0;
    const lookupBuffer = new RingBuffer(LOOKUP_BUFFER_SIZE, (LOOKUP_BUFFER_SIZE + lookupBufferOffset) % LOOKUP_BUFFER_SIZE);
    const outputBuffer = Buffer.alloc(buffer.length * 2); // compressed data should never be larger than the uncompressed data but just to be save we use a larger buffer
    let outputBufferByteIndex = 0;

    const readNextByte = () => {
        return buffer.readUInt8(bufferByteIndex++);
    };

    const writeNextByte = (value) => {
        if (outputBufferByteIndex === outputBuffer.length) {
            throw 'Output buffer is full, cannot write more data';
        }

        outputBuffer.writeUInt8(value, outputBufferByteIndex++);
    };

    const encodeFlagByte = (flags) => {
        let flagByte = 0;

        if (flags.length !== 8) {
            throw `invalid flags array`;
        }

        flags.forEach((flag, index) => {
            if (flag) {
                flagByte |= 1 << index;
            }
        });

        return flagByte;
    };

    while (true) {
        const flags = [];
        // A temporary output buffer that holds all bytes while the flags byte is built
        const outputBuffer = [];

        // Every 8 flags we write t he flag byte and the output buffer to the output
        while (flags.length < 8) {
            // Read 18 bytes (the max number of bytes we can lookup)
            const lookup = [];
            for (let i = 0; i < 18; i++) {
                const byte = readNextByte();
                lookup.push(byte);
            }
            // Reset the read index, the previous reads were just lookaheads
            bufferByteIndex -= 18;

            // Check if we find the lookup data in the lookup buffer
            // We start with the longest sequence and decrease the length step by step until we have a match or
            // in the worst case no match at all
            let index;
            let length;
            for (length = 18; length > 2; length--) {
                // Take slices with decreasing lengths and see if we can find them in the lookup buffer
                const lookupSlice = lookup.slice(0, length);
                index = lookupBuffer.find(lookupSlice);

                if (index > -1) {
                    break;
                }
            }

            if (index === -1) {
                // Lookup was unsuccessful, we just copy the byte into the output
                console.log('copy byte');
                flags.push(true); // true === copy byte
                const nextByte = readNextByte();
                outputBuffer.push(nextByte);
                lookupBuffer.appendUInt8(nextByte);
            } else {
                // Lookup success
                console.log('lookup success', length, index);
                flags.push(false); // false === lookup bytes
                const lookup1 = index >> 4;
                const lookup2 = ((index & 0x0F) << 4) | ((length - 3) & 0x0F);

                outputBuffer.push(lookup1);
                outputBuffer.push(lookup2);

                for (let i = 0; i < length; i++) {
                    lookupBuffer.appendUInt8(readNextByte());
                }
            }
        }

        // We have 8 flags, so we can now write the flags byte...
        writeNextByte(encodeFlagByte(flags));
        // ... and the pertaining data (data & lookup)
        outputBuffer.forEach(byte => writeNextByte(byte));
    }
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
        // All compressed sections have a -18 buffer offset, seems like there is an 18 byte header
        // Actually, all sections start with compressed data, there seems not to be a 18 byte header... where do the
        // 18 byte come from? Init data? Where does the init data come from?
        // TODO why the 18 byte offset?
        // TODO where are the sections and their lengths described?
        const lookupBufferOffset = -18;

        sectionDecompressionMetadata.push([sectionStart, sectionEnd, compressed, lookupBufferOffset]);
    });

    return sectionDecompressionMetadata;
}

function decompressFile(sections, fileName, targetDirectory) {
    const data = fs.readFileSync(fileName);

    sections.forEach(([start, end, compressed, lookupBufferOffset], index) => {
        if (end === -1) {
            end = data.length;
        }

        const sectionData = data.slice(start, end);
        const targetFileName = path.basename(fileName) + '.' + S(start).padLeft(8, '0');
        let targetFileNameFull = path.join(targetDirectory, targetFileName);

        console.log(`Section ${index}: ${start}-${end}`);

        if (compressed) {
            console.log(`Decompressing...`);
            const decompressedData = decompress(sectionData, lookupBufferOffset);
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

            const recompressedData = compress(decompressedData, lookupBufferOffset);
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
