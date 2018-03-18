/*
 * YI Mirrorless Firmware Tools
 * Author: Mario Guggenberger <mg@protyposis.net>
 * Licensed under the GPLv3
 */
'use strict';

const S = require('string');

const LOOKUP_BUFFER_SIZE = 0x1000;

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
        this.bufferLevel = 0;
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
        let o = offset;
        if (this.bufferLevel < this.buffer.length) {
            // Wrap offset around fillLevel
            const shift = this.bufferIndex - this.bufferLevel;
            o = ((offset - shift) % this.buffer.length % this.bufferLevel) + shift + this.buffer.length;
        }
        return this.buffer.readUInt8(o % this.buffer.length);
    }

    appendUInt8(value) {
        this.buffer.writeUInt8(value, this.bufferIndex);
        this.bufferIndex = ++this.bufferIndex % this.buffer.length;
        if (this.bufferLevel < this.buffer.length) {
            this.bufferLevel++;
        }
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

    find(byteArray, length) {
        if (length === undefined) {
            length = byteArray.length;
        }

        const check = (x) => {
            for (let y = 1; y < length; y++) {
                if (this.readUInt8((x + y) % this.buffer.length) !== byteArray[y]) {
                    return y - 1;
                }
            }

            return length - 1;
        };

        let maxLength = 0;
        let maxLengthIndex = -1;

        for (let x = 2; x < this.bufferLevel; x++) {
            // Search backwards from the most recently written byte
            const searchIndex = (this.bufferIndex - x + this.buffer.length) % this.buffer.length;
            // Check the first value and if it matched, check all remaining ones
            if (this.readUInt8(searchIndex) === byteArray[0]) {
                const length = check(searchIndex) + 1;
                if (length > maxLength) {
                    maxLength = length;
                    maxLengthIndex = searchIndex;
                }
            }
        }

        return [maxLength, maxLengthIndex];
    }
}

const decodeFlagByte = (flagByte) => {
    const flags = [];

    for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
        const copyByte = (flagByte >> bitIndex) & 1 === 1;
        flags.push(copyByte);
    }

    return flags;
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

const toBitString = (value, bits) => {
    return S(value.toString(2)).padLeft(bits, '0');
};

const toHexString = (value, bytes) => {
    return S(value.toString(16)).padLeft(bytes * 2, '0').toString().toUpperCase();
};

/**
 * Decompresses compressed data in section 0 of the firmware.
 * @param buffer
 * @returns {Buffer}
 */
function decompress(buffer, lookupBufferOffset) {
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
                }

                lookupBytes.forEach(byte => {
                    lookupBuffer.appendUInt8(byte);
                    writeNextByte(byte);
                });
            }
        }
    }

    return outputBuffer.slice(0, outputBufferByteIndex);
}

function compress(buffer, lookupBufferOffset) {
    const VERBOSE = false;

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

    while (bufferByteIndex < buffer.length) {
        const flags = [];
        // A temporary output buffer that holds all bytes while the flags byte is built
        const outputBuffer = [];

        // Every 8 flags we write the flag byte and the output buffer to the output
        while (flags.length < 8) {
            const remainingInputBytes = buffer.length - bufferByteIndex;

            if (remainingInputBytes === 0) {
                // Fill up flags and exit encoding loop
                while(flags.length < 8) {
                    flags.push(true);
                }
                break;
            }

            // Read 18 bytes (the max number of bytes we can lookup)
            const lookup = [];
            for (let i = 0; i < Math.min(18, remainingInputBytes); i++) {
                const byte = readNextByte();
                lookup.push(byte);
            }
            // Reset the read index, the previous reads were just lookaheads
            bufferByteIndex -= lookup.length;

            // Check if we find the lookup data in the lookup buffer
            // We start with the longest sequence and decrease the length step by step until we have a match or
            // in the worst case no match at all
            const [length, index] = lookupBuffer.find(lookup);

            if (index === -1 || length < 3) {
                // Lookup was unsuccessful, we just copy the byte into the output
                flags.push(true); // true === copy byte
                const nextByte = readNextByte();
                outputBuffer.push(nextByte);
                lookupBuffer.appendUInt8(nextByte);
                if (VERBOSE) {
                    console.log(`copy byte 0x${nextByte.toString(16)}`);
                }
            } else {
                // Lookup success
                flags.push(false); // false === lookup bytes

                if (index > 0x0FFF) {
                    throw `invalid lookup index size ${index}`;
                }
                if (length - 3 > 0x0F) {
                    throw `invalid lookup length ${length}`;
                }

                const lookup1 = index & 0xFF;
                const lookup2 = ((index & 0xF00) >> 4) | ((length - 3) & 0x0F);

                outputBuffer.push(lookup1);
                outputBuffer.push(lookup2);

                for (let i = 0; i < length; i++) {
                    lookupBuffer.appendUInt8(readNextByte());
                }

                if (VERBOSE) {
                    console.log(`lookup success 0x${toHexString(lookup1 << 8 | lookup2, 2)} ${length}@${index} `);
                }
            }
        }

        // We have 8 flags, so we can now write the flags byte...
        const flagByte = encodeFlagByte(flags);
        if (VERBOSE) {
            const flagsByteBinaryString = toBitString(flagByte, 8);
            const flagsString = flags.map((flag) => flag ? 'C' : 'L').reduce((a, b) => a + b);
            console.log(`flag: 0x${toHexString(flagByte, 1)}/${flagsByteBinaryString} => ${flagsString}`);
        }
        writeNextByte(flagByte);
        // ... and the pertaining data (data & lookup)
        outputBuffer.forEach(byte => writeNextByte(byte));
    }
}

exports.decompress = decompress;
exports.compress = compress;