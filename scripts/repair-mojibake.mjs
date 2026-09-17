const windows1252Specials = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";
const specialBytes = new Map(Array.from(windows1252Specials, (character, index) => [character, 0x80 + index]));
const decoder = new TextDecoder("utf-8", { fatal: true });

function windows1252Byte(character) {
  const codePoint = character.codePointAt(0);
  if (codePoint <= 0xff) return codePoint;
  return specialBytes.get(character);
}

function repairPass(value) {
  let repaired = "";
  for (let index = 0; index < value.length;) {
    const character = value[index];
    if (!"ÂÃÎâð".includes(character)) {
      repaired += character;
      index += 1;
      continue;
    }

    const firstByte = windows1252Byte(character);
    const length = firstByte >= 0xf0 ? 4 : firstByte >= 0xe0 ? 3 : 2;
    const segment = Array.from(value.slice(index, index + length));
    const bytes = segment.map(windows1252Byte);
    if (segment.length === length && bytes.every((byte) => byte !== undefined)) {
      try {
        const decoded = decoder.decode(Uint8Array.from(bytes));
        repaired += decoded;
        index += segment.join("").length;
        continue;
      } catch {
        // Not a valid misdecoded UTF-8 sequence; keep the original text.
      }
    }
    repaired += character;
    index += 1;
  }
  return repaired;
}

export function repairMojibake(value) {
  if (typeof value !== "string") return value;
  let repaired = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = repairPass(repaired);
    if (next === repaired) break;
    repaired = next;
  }
  return repaired;
}
