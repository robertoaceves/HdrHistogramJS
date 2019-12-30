import { ResizeError } from "./ResizeError";

/**
 * A packed-value, sparse array context used for storing 64 bit signed values.
 *
 * An array context is optimised for tracking sparsely set (as in mostly zeros) values that tend to not make
 * use pof the full 64 bit value range even when they are non-zero. The array context's internal representation
 * is such that the packed value at each virtual array index may be represented by 0-8 bytes of actual storage.
 *
 * An array context encodes the packed values in 8 "set trees" with each set tree representing one byte of the
 * packed value at the virtual index in question. The {@link #getPackedIndex(int, int, boolean)} method is used
 * to look up the byte-index corresponding to the given (set tree) value byte of the given virtual index, and can
 * be used to add entries to represent that byte as needed. As a succesful {@link #getPackedIndex(int, int, boolean)}
 * may require a resizing of the array, it can throw a {@link ResizeException} to indicate that the requested
 * packed index cannot be found or added without a resize of the physical storage.
 *
 */
export const MINIMUM_INITIAL_PACKED_ARRAY_CAPACITY = 16;
const MAX_SUPPORTED_PACKED_COUNTS_ARRAY_LENGTH = Math.pow(2, 30); //(Short.MAX_VALUE / 4);  TODO ALEX why ???
const SET_0_START_INDEX = 0;
const NUMBER_OF_SETS = 8;
const LEAF_LEVEL_SHIFT = 3;
const NON_LEAF_ENTRY_SLOT_INDICATORS_OFFSET = 0;
const NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS = 2;
const PACKED_ARRAY_GROWTH_INCREMENT = 16;
const PACKED_ARRAY_GROWTH_FRACTION_POW2 = 4;

const { floor, pow, ceil, log2, max } = Math;

const bitCount = (n: number) => {
  var bits = 0;
  while (n !== 0) {
    bits += bitCount32(n | 0);
    n /= 0x100000000;
  }
  return bits;
};

const bitCount32 = (n: number) => {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
};

export class PackedArrayContext {
  public readonly isPacked: boolean;
  readonly physicalLength: number;

  private array: ArrayBuffer;
  private byteArray: Uint8Array;
  private shortArray: Uint16Array;
  private longArray: Float64Array;
  private populatedShortLength: number = 0;
  private virtualLength: number;
  private topLevelShift: number = Number.MAX_VALUE; // Make it non-sensical until properly initialized.

  constructor(virtualLength: number, initialPhysicalLength: number) {
    this.physicalLength = Math.max(
      initialPhysicalLength,
      MINIMUM_INITIAL_PACKED_ARRAY_CAPACITY
    );
    this.isPacked =
      this.physicalLength <= MAX_SUPPORTED_PACKED_COUNTS_ARRAY_LENGTH;
    this.array = new ArrayBuffer(this.physicalLength * 8);
    this.initArrayViews(this.array);
    this.init(virtualLength);
  }

  private initArrayViews(array: ArrayBuffer) {
    this.byteArray = new Uint8Array(array);
    this.shortArray = new Uint16Array(array);
    this.longArray = new Float64Array(array);
  }

  private init(virtualLength: number) {
    if (!this.isPacked) {
      // Deal with non-packed context init:
      this.virtualLength = virtualLength;
      return;
    }

    this.populatedShortLength = SET_0_START_INDEX + 8;

    // Populate empty root entries, and point to them from the root indexes:
    for (let i = 0; i < NUMBER_OF_SETS; i++) {
      this.setAtShortIndex(SET_0_START_INDEX + i, 0);
    }

    this.setVirtualLength(virtualLength);
  }

  public copyAndIncreaseSize(newPhysicalArrayLength: number) {
    const ctx = new PackedArrayContext(
      this.virtualLength,
      newPhysicalArrayLength
    );
    if (this.isPacked) {
      ctx.populateEquivalentEntriesWithZerosFromOther(this);
    }
    return ctx;
  }

  public getPopulatedShortLength() {
    return this.populatedShortLength;
  }

  public getPopulatedLongLength() {
    return (this.getPopulatedShortLength() + 3) >> 2; // round up
  }

  public setAtByteIndex(byteIndex: number, value: number) {
    this.byteArray[byteIndex] = value;
  }

  public getAtByteIndex(byteIndex: number) {
    return this.byteArray[byteIndex];
  }

  setPopulatedLongLength(newPopulatedLongLength: number) {
    this.populatedShortLength = newPopulatedLongLength << 2;
  }

  public getVirtualLength() {
    return this.virtualLength;
  }
  public length() {
    return this.physicalLength;
  }

  setAtShortIndex(shortIndex: number, value: number) {
    /*
    const longIndex = floor(shortIndex / 4); // shortIndex >> 2
    const shortShift = (shortIndex % 4) * 16; // (shortIndex & 0x3) << 4;
    const shortMask = 0xffff * pow(2, shortShift); // ((long) 0xffff) << shortShift
    const shortValueAsLong = value & 0xffff;
    this.setValuePart(longIndex, shortValueAsLong, shortMask, shortShift);*/
    this.shortArray[shortIndex] = value;
  }

  setAtLongIndex(longIndex: number, value: number) {
    this.longArray[longIndex] = value;
  }

  getAtShortIndex(shortIndex: number) {
    return this.shortArray[shortIndex];
  }

  /*
  setValuePart(
    longIndex: number,
    valuePartAsLong: number,
    valuePartMask: number,
    valuePartShift: number
  ) {
    const currentLongValue = 0; //getAtLongIndex(longIndex);
    const newLongValue =
      (currentLongValue & ~valuePartMask) | (valuePartAsLong << valuePartShift);
    //success = casAtLongIndex(longIndex, currentLongValue, newLongValue);
  }*/

  getIndexAtShortIndex(shortIndex: number) {
    //return (short) ((getAtLongIndex(shortIndex >> 2) >> ((shortIndex & 0x3) << 4)) & 0x7fff);
    // TODO check
    return this.shortArray[shortIndex];
  }

  setPackedSlotIndicators(entryIndex: number, newPackedSlotIndicators: number) {
    this.setAtShortIndex(
      entryIndex + NON_LEAF_ENTRY_SLOT_INDICATORS_OFFSET,
      newPackedSlotIndicators
    );
  }

  getPackedSlotIndicators(entryIndex: number) {
    return (
      this.shortArray[entryIndex + NON_LEAF_ENTRY_SLOT_INDICATORS_OFFSET] &
      0xffff
    );
  }

  private getIndexAtEntrySlot(entryIndex: number, slot: number) {
    return this.getAtShortIndex(
      entryIndex + NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS + slot
    );
  }

  setIndexAtEntrySlot(entryIndex: number, slot: number, newIndexValue: number) {
    this.setAtShortIndex(
      entryIndex + NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS + slot,
      newIndexValue
    );
  }

  private expandArrayIfNeeded(entryLengthInLongs: number) {
    const currentLength = this.length();
    if (currentLength < this.getPopulatedLongLength() + entryLengthInLongs) {
      const growthIncrement = max(
        entryLengthInLongs,
        PACKED_ARRAY_GROWTH_INCREMENT,
        this.getPopulatedLongLength() >> PACKED_ARRAY_GROWTH_FRACTION_POW2
      );
      throw new ResizeError(currentLength + growthIncrement);
    }
  }

  private newEntry(entryLengthInShorts: number) {
    // Add entry at the end of the array:

    const newEntryIndex = this.populatedShortLength;
    this.expandArrayIfNeeded((entryLengthInShorts >> 2) + 1);
    this.populatedShortLength = newEntryIndex + entryLengthInShorts;

    for (let i = 0; i < entryLengthInShorts; i++) {
      this.setAtShortIndex(newEntryIndex + i, -1); // Poison value -1. Must be overriden before reads
    }
    return newEntryIndex;
  }

  private newLeafEntry() {
    // Add entry at the end of the array:
    let newEntryIndex;

    newEntryIndex = this.getPopulatedLongLength();
    this.expandArrayIfNeeded(1);

    this.setPopulatedLongLength(newEntryIndex + 1);

    this.setAtLongIndex(newEntryIndex, 0);

    return newEntryIndex;
  }

  /**
   * Expand entry as indicated.
   *
   * @param existingEntryIndex the index of the entry
   * @param entryPointerIndex  index to the slot pointing to the entry (needs to be fixed up)
   * @param insertedSlotIndex  realtive [packed] index of slot being inserted into entry
   * @param insertedSlotMask   mask value fo slot being inserted
   * @param nextLevelIsLeaf    the level below this one is a leaf level
   * @return the updated index of the entry (-1 if epansion failed due to conflict)
   * @throws RetryException if expansion fails due to concurrent conflict, and caller should try again.
   */
  expandEntry(
    existingEntryIndex: number,
    entryPointerIndex: number,
    insertedSlotIndex: number,
    insertedSlotMask: number,
    nextLevelIsLeaf: boolean
  ): number {
    let packedSlotIndicators =
      this.getAtShortIndex(existingEntryIndex) & 0xffff;
    packedSlotIndicators |= insertedSlotMask;
    const numberOfslotsInExpandedEntry = bitCount(packedSlotIndicators);

    if (insertedSlotIndex >= numberOfslotsInExpandedEntry) {
      throw new Error(
        "inserted slot index is out of range given provided masks"
      );
    }

    const expandedEntryLength =
      numberOfslotsInExpandedEntry + NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS;

    // Create new next-level entry to refer to from slot at this level:
    let indexOfNewNextLevelEntry = 0;
    if (nextLevelIsLeaf) {
      indexOfNewNextLevelEntry = this.newLeafEntry(); // Establish long-index to new leaf entry
    } else {
      // TODO: Optimize this by creating the whole sub-tree here, rather than a step that will immediaterly expand

      // Create a new 1 word (empty, no slots set) entry for the next level:
      indexOfNewNextLevelEntry = this.newEntry(
        NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS
      ); // Establish short-index to new leaf entry

      this.setPackedSlotIndicators(indexOfNewNextLevelEntry, 0);
    }

    const insertedSlotValue = indexOfNewNextLevelEntry;

    const expandedEntryIndex = this.newEntry(expandedEntryLength);

    // populate the packed indicators word:
    this.setPackedSlotIndicators(expandedEntryIndex, packedSlotIndicators);

    // Populate the inserted slot with the iundex of the new next level entry:
    this.setIndexAtEntrySlot(
      expandedEntryIndex,
      insertedSlotIndex,
      insertedSlotValue
    );

    // Set the pointer to the updated entry index. If CAS fails, discard by throwing retry expecption.
    this.setAtShortIndex(entryPointerIndex, expandedEntryIndex);

    return expandedEntryIndex;
  }

  //
  //   ######   ######## ########    ##     ##    ###    ##             ## #### ##    ## ########  ######## ##     ##
  //  ##    ##  ##          ##       ##     ##   ## ##   ##            ##   ##  ###   ## ##     ## ##        ##   ##
  //  ##        ##          ##       ##     ##  ##   ##  ##           ##    ##  ####  ## ##     ## ##         ## ##
  //  ##   #### ######      ##       ##     ## ##     ## ##          ##     ##  ## ## ## ##     ## ######      ###
  //  ##    ##  ##          ##        ##   ##  ######### ##         ##      ##  ##  #### ##     ## ##         ## ##
  //  ##    ##  ##          ##         ## ##   ##     ## ##        ##       ##  ##   ### ##     ## ##        ##   ##
  //   ######   ########    ##          ###    ##     ## ######## ##       #### ##    ## ########  ######## ##     ##
  //

  getRootEntry(setNumber: number, insertAsNeeded: boolean = false) {
    const entryPointerIndex = SET_0_START_INDEX + setNumber;
    let entryIndex = this.getIndexAtShortIndex(entryPointerIndex);

    if (entryIndex == 0) {
      if (!insertAsNeeded) {
        return 0; // Index does not currently exist in packed array;
      }

      entryIndex = this.newEntry(NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS);
      // Create a new empty (no slots set) entry for the next level:
      this.setPackedSlotIndicators(entryIndex, 0);

      this.setAtShortIndex(entryPointerIndex, entryIndex);
    }
    return entryIndex;
  }

  /**
   * Get the byte-index (into the packed array) corresponding to a given (set tree) value byte of given virtual index.
   * Inserts new set tree nodes as needed if indicated.
   *
   * @param setNumber      The set tree number (0-7, 0 corresponding with the LSByte set tree)
   * @param virtualIndex   The virtual index into the PackedArray
   * @param insertAsNeeded If true, will insert new set tree nodes as needed if they do not already exist
   * @return the byte-index corresponding to the given (set tree) value byte of the given virtual index
   */
  // getPackedIndex(byteNum, index, true)
  getPackedIndex(
    setNumber: number,
    virtualIndex: number,
    insertAsNeeded: boolean
  ) {
    if (virtualIndex >= this.virtualLength) {
      throw new Error(
        `Attempting access at index ${virtualIndex}, beyond virtualLength ${
          this.virtualLength
        }`
      );
    }

    let entryPointerIndex = SET_0_START_INDEX + setNumber; // TODO init needed ?
    let entryIndex = this.getRootEntry(setNumber, insertAsNeeded);
    if (entryIndex == 0) {
      return -1; // Index does not currently exist in packed array;
    }

    // Work down the levels of non-leaf entries:
    for (
      let indexShift = this.topLevelShift;
      indexShift >= LEAF_LEVEL_SHIFT;
      indexShift -= 4
    ) {
      const nextLevelIsLeaf = indexShift === LEAF_LEVEL_SHIFT;
      // Target is a packedSlotIndicators entry
      const packedSlotIndicators = this.getPackedSlotIndicators(entryIndex);
      const slotBitNumber = (virtualIndex / pow(2, indexShift)) & 0xf; //(virtualIndex >>> indexShift) & 0xf;
      const slotMask = pow(2, slotBitNumber);
      const slotsBelowBitNumber = packedSlotIndicators % slotMask; //packedSlotIndicators & (slotMask - 1);
      const slotNumber = bitCount(slotsBelowBitNumber);

      if ((packedSlotIndicators & slotMask) == 0) {
        // The entryIndex slot does not have the contents we want
        if (!insertAsNeeded) {
          return -1; // Index does not currently exist in packed array;
        }

        // Expand the entry, adding the index to new entry at the proper slot:
        entryIndex = this.expandEntry(
          entryIndex,
          entryPointerIndex,
          slotNumber,
          slotMask,
          nextLevelIsLeaf
        );
      }

      // Next level's entry pointer index is in the appropriate slot in in the entries array in this entry:
      entryPointerIndex =
        entryIndex + NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS + slotNumber;

      entryIndex = this.getIndexAtShortIndex(entryPointerIndex);
      if (entryIndex == 0) {
        throw new Error("Retry exeception TODO ???");
      }
    }

    // entryIndex is the long-index of a leaf entry that contains the value byte for the given set

    const byteIndex = (entryIndex << 3) + (virtualIndex & 0x7); // Determine byte index offset within leaf entry
    return byteIndex;
  }

  // setAtByteIndex(packedIndex, byteToWrite)

  private determineTopLevelShiftForVirtualLength(virtualLength: number) {
    const sizeMagnitude = ceil(log2(virtualLength));
    const eightsSizeMagnitude = sizeMagnitude - 3;
    let multipleOfFourSizeMagnitude = ceil(eightsSizeMagnitude / 4) * 4;
    multipleOfFourSizeMagnitude = max(multipleOfFourSizeMagnitude, 8);
    const topLevelShiftNeeded = multipleOfFourSizeMagnitude - 4 + 3;
    return topLevelShiftNeeded;
  }

  private setVirtualLength(virtualLength: number) {
    if (!this.isPacked) {
      throw new Error(
        "Should never be adjusting the virtual size of a non-packed context"
      );
    }
    this.topLevelShift = this.determineTopLevelShiftForVirtualLength(
      virtualLength
    );
    this.virtualLength = virtualLength;
  }

  //
  //  ##     ##         ########   #######  ########  ##     ## ##          ###    ######## ########
  //   ##   ##          ##     ## ##     ## ##     ## ##     ## ##         ## ##      ##    ##
  //    ## ##           ##     ## ##     ## ##     ## ##     ## ##        ##   ##     ##    ##
  //     ###    ####### ########  ##     ## ########  ##     ## ##       ##     ##    ##    ######
  //    ## ##           ##        ##     ## ##        ##     ## ##       #########    ##    ##
  //   ##   ##          ##        ##     ## ##        ##     ## ##       ##     ##    ##    ##
  //  ##     ##         ##         #######  ##         #######  ######## ##     ##    ##    ########
  //

  private resizeArray(newLength: number) {
    const tmp = new Uint8Array(newLength);
    tmp.set(this.byteArray);
    this.array = tmp.buffer;
    this.initArrayViews(this.array);
  }

  private populateEquivalentEntriesWithZerosFromOther(
    other: PackedArrayContext
  ) {
    if (this.virtualLength < other.getVirtualLength()) {
      throw new Error("Cannot populate array of smaller virtrual length");
    }

    for (let i = 0; i < NUMBER_OF_SETS; i++) {
      const otherEntryIndex = other.getAtShortIndex(SET_0_START_INDEX + i);
      if (otherEntryIndex == 0) continue; // No tree to duplicate
      let entryIndexPointer = SET_0_START_INDEX + i;
      for (i = this.topLevelShift; i > other.topLevelShift; i -= 4) {
        // for each inserted level:

        // Allocate entry in other:
        const sizeOfEntry = NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS + 1;
        const newEntryIndex = this.newEntry(sizeOfEntry);

        // Link new level in.
        this.setAtShortIndex(entryIndexPointer, newEntryIndex);
        // Populate new level entry, use pointer to slot 0 as place to populate under:
        this.setPackedSlotIndicators(newEntryIndex, 0x1); // Slot 0 populated
        entryIndexPointer =
          newEntryIndex + NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS; // Where the slot 0 index goes.
      }
      this.copyEntriesAtLevelFromOther(
        other,
        otherEntryIndex,
        entryIndexPointer,
        other.topLevelShift
      );
    }
  }

  private copyEntriesAtLevelFromOther(
    other: PackedArrayContext,
    otherLevelEntryIndex: number,
    levelEntryIndexPointer: number,
    otherIndexShift: number
  ) {
    const nextLevelIsLeaf = otherIndexShift == LEAF_LEVEL_SHIFT;
    const packedSlotIndicators = other.getPackedSlotIndicators(
      otherLevelEntryIndex
    );
    const numberOfSlots = bitCount(packedSlotIndicators);
    const sizeOfEntry = NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS + numberOfSlots;
    const entryIndex = this.newEntry(sizeOfEntry);

    this.setAtShortIndex(levelEntryIndexPointer, entryIndex);
    this.setAtShortIndex(
      entryIndex + NON_LEAF_ENTRY_SLOT_INDICATORS_OFFSET,
      packedSlotIndicators
    );

    for (let i = 0; i < numberOfSlots; i++) {
      if (nextLevelIsLeaf) {
        // Make leaf in other:
        const leafEntryIndex = this.newLeafEntry();

        this.setIndexAtEntrySlot(entryIndex, i, leafEntryIndex);

        // OPTIM
        // avoid iteration on all the values of the source ctx
        const otherNextLevelEntryIndex = other.getIndexAtEntrySlot(
          otherLevelEntryIndex,
          i
        );
        this.longArray[leafEntryIndex] =
          other.longArray[otherNextLevelEntryIndex];
      } else {
        const otherNextLevelEntryIndex = other.getIndexAtEntrySlot(
          otherLevelEntryIndex,
          i
        );
        this.copyEntriesAtLevelFromOther(
          other,
          otherNextLevelEntryIndex,
          entryIndex + NON_LEAF_ENTRY_HEADER_SIZE_IN_SHORTS + i,
          otherIndexShift - 4
        );
      }
    }
  }
}