/*
 * This is a TypeScript port of the original Java version, which was written by
 * Gil Tene as described in
 * https://github.com/HdrHistogram/HdrHistogram
 * and released to the public domain, as explained at
 * http://creativecommons.org/publicdomain/zero/1.0/
 */
import ByteBuffer from "./ByteBuffer";

const { pow, floor } = Math;

const TWO_POW_7 = pow(2, 7);
const TWO_POW_14 = pow(2, 14);
const TWO_POW_21 = pow(2, 21);
const TWO_POW_28 = pow(2, 28);
const TWO_POW_35 = pow(2, 35);
const TWO_POW_42 = pow(2, 42);
const TWO_POW_49 = pow(2, 49);
const TWO_POW_56 = pow(2, 56);

/**
 * This class provides encoding and decoding methods for writing and reading
 * ZigZag-encoded LEB128-64b9B-variant (Little Endian Base 128) values to/from a
 * {@link ByteBuffer}. LEB128's variable length encoding provides for using a
 * smaller nuber of bytes for smaller values, and the use of ZigZag encoding
 * allows small (closer to zero) negative values to use fewer bytes. Details
 * on both LEB128 and ZigZag can be readily found elsewhere.
 *
 * The LEB128-64b9B-variant encoding used here diverges from the "original"
 * LEB128 as it extends to 64 bit values: In the original LEB128, a 64 bit
 * value can take up to 10 bytes in the stream, where this variant's encoding
 * of a 64 bit values will max out at 9 bytes.
 *
 * As such, this encoder/decoder should NOT be used for encoding or decoding
 * "standard" LEB128 formats (e.g. Google Protocol Buffers).
 */
class ZigZagEncoding {


  /**
   * Writes a long value to the given buffer in LEB128 ZigZag encoded format
   * (negative numbers not supported)
   * @param buffer the buffer to write to
   * @param value  the value to write to the buffer
   */
  static encode(buffer: ByteBuffer, value: number) {
    value = value * 2;
    if (value < TWO_POW_7) {
      buffer.put(value);
    } else {
      buffer.put((value %  0x80) + 0x80);
      if (value < TWO_POW_14) {
        buffer.put(floor(value / TWO_POW_7));
      } else {
        buffer.put(floor(value / TWO_POW_7) + 0x80);
        if (value < TWO_POW_21) {
          buffer.put(floor(value / TWO_POW_14));
        } else {
          buffer.put(floor(value / TWO_POW_14) + 0x80);
          if (value < TWO_POW_28) {
            buffer.put(floor(value / TWO_POW_21));
          } else {
            buffer.put(floor(value / TWO_POW_21) + 0x80);
            if (value < TWO_POW_35) {
              buffer.put(floor(value / TWO_POW_28));
            } else {
              buffer.put(floor(value / TWO_POW_28) + 0x80);
              if (value < TWO_POW_42) {
                buffer.put(floor(value / TWO_POW_35));
              } else {
                buffer.put(floor(value / TWO_POW_35) + 0x80);
                if (value < TWO_POW_49) {
                  buffer.put(floor(value / TWO_POW_42));
                } else {
                  buffer.put(floor(value / TWO_POW_42) + 0x80);
                  if (value < TWO_POW_56) {
                    buffer.put(floor(value / TWO_POW_49));
                  } else {
                    buffer.put(floor(value / TWO_POW_49) + 0x80);
                    buffer.put(floor(value / TWO_POW_56)); 
                  }    
                }
              }
            }
          }
        }
      }
    }
  }


  /**
   * Read an LEB128-64b9B ZigZag encoded long value from the given buffer
   * (negative numbers not supported)
   * @param buffer the buffer to read from
   * @return the value read from the buffer
   */
  static decode(buffer: ByteBuffer): number {
    let v = buffer.get();
    let value = v & 0x7F;
    if ((v & 0x80) != 0) {
      v = buffer.get();
      value += (v & 0x7F) * TWO_POW_7;
      if ((v & 0x80) != 0) {
        v = buffer.get();
        value += (v & 0x7F) * TWO_POW_14;
        if ((v & 0x80) != 0) {
          v = buffer.get();
          value += (v & 0x7F) * TWO_POW_21;
          if ((v & 0x80) != 0) {
            v = buffer.get();
            value += (v & 0x7F) * TWO_POW_28;
            if ((v & 0x80) != 0) {
              v = buffer.get();
              value += (v & 0x7F) * TWO_POW_35;
              if ((v & 0x80) != 0) {
                v = buffer.get();
                value += (v & 0x7F) * TWO_POW_42;
                if ((v & 0x80) != 0) {
                  v = buffer.get();
                  value += (v & 0x7F) * TWO_POW_49;
                  if ((v & 0x80) != 0) {
                    v = buffer.get();
                    value += (v & 0x7F) * TWO_POW_56;
                  }
                }
              }
            }
          }
        }
      }
    }
    value = value / 2;
    return value;
  }

}

export default ZigZagEncoding;