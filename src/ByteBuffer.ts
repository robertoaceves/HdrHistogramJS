
const { pow, floor } = Math;
const TWO_POW_32 = pow(2, 32);

class ByteBuffer {

  index: number;

  data: Uint8Array;

  int32ArrayForConvert: Uint32Array;
  int8ArrayForConvert: Uint8Array;


  constructor(size = 16) {
    this.index = 0;
    this.data = new Uint8Array(size);
    this.int32ArrayForConvert = new Uint32Array(1);
    this.int8ArrayForConvert = new Uint8Array(this.int32ArrayForConvert.buffer);
  }

  put(value: number) {
    if (this.index === this.data.length) {
      const oldArray = this.data;
      this.data = new Uint8Array(this.data.length * 2);
      this.data.set(oldArray);
    }
    this.data[this.index] = value;
    this.index++;
  }

  putInt32(value: number) {
    if ((this.data.length - this.index) < 4) {
      const oldArray = this.data;
      this.data = new Uint8Array(this.data.length * 2 + 4);
      this.data.set(oldArray);
    }
    this.int32ArrayForConvert[0] = value;
    this.data.set(this.int8ArrayForConvert, this.index);
    this.index = this.index + 4;
  }

  putInt64(value: number) {
    this.putInt32(value);
    this.putInt32(floor(value / TWO_POW_32))
  }

  get(): number {
    const value = this.data[this.index];
    this.index++;
    return value;
  }

  getInt32(): number {
    this.int8ArrayForConvert.set(this.data.slice(this.index, this.index + 4))
    const value = this.int32ArrayForConvert[0];
    this.index = this.index + 4;
    return value;
  }

  getInt64(): number {
    const low = this.getInt32();
    const high = this.getInt32();
    return high * TWO_POW_32 + low;
  }

  resetIndex() {
    this.index = 0;
  }

} 

export default ByteBuffer