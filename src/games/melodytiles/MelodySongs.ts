import { Mathf } from "../../kit";

/**
 * The song book: classic melodies that are all in the public domain (composed before 1900, traditional, or nursery
 * rhymes). Each note is "Name:beats" where name is a pitch like C4, F#5 or Bb3; beats default to 0.5 (one tile row).
 * Notes longer than half a beat become hold tiles. (Port of MelodySongs.cs.)
 */
export interface Song {
  Title: string;
  Composer: string;
  Notes: string;
  /** starting rows per second */
  Speed: number;
  /** theme colour (hex) */
  Hue: number;
}

function Midi(n: string) {
  const baseNote = [9, 11, 0, 2, 4, 5, 7]; // A B C D E F G
  const letter = n[0].toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
  let semis = baseNote[Mathf.clamp(letter, 0, 6)];
  let i = 1;
  if (i < n.length && n[i] === "#") { semis++; i++; }
  else if (i < n.length && n[i] === "b") { semis--; i++; }
  let octave = 4;
  if (i < n.length) { const o = n.substring(i); octave = /^[+-]?\d+$/.test(o) ? parseInt(o, 10) : 0; } // int.TryParse: 0 on failure
  return 12 * (octave + 1) + semis;
}

export const MelodySongs = {
  All: [
    {
      Title: "TWINKLE LITTLE STAR", Composer: "Traditional", Speed: 2.8, Hue: 0x7fb8ff,
      Notes: "C4 C4 G4 G4 A4 A4 G4:1 F4 F4 E4 E4 D4 D4 C4:1 G4 G4 F4 F4 E4 E4 D4:1 G4 G4 F4 F4 E4 E4 D4:1 " +
      "C4 C4 G4 G4 A4 A4 G4:1 F4 F4 E4 E4 D4 D4 C4:1",
    },
    {
      Title: "MARY HAD A LITTLE LAMB", Composer: "Traditional", Speed: 3.0, Hue: 0xff9ec4,
      Notes: "E4 D4 C4 D4 E4 E4 E4:1 D4 D4 D4:1 E4 G4 G4:1 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:1.5",
    },
    {
      Title: "ODE TO JOY", Composer: "Beethoven", Speed: 3.2, Hue: 0xffc861,
      Notes: "E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:0.75 D4:0.25 D4:1 " +
      "E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:0.75 C4:0.25 C4:1 " +
      "D4 D4 E4 C4 D4 E4:0.25 F4:0.25 E4 C4 D4 E4:0.25 F4:0.25 E4 D4 C4 D4 G3:1 " +
      "E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:0.75 C4:0.25 C4:1",
    },
    {
      Title: "JINGLE BELLS", Composer: "J. Pierpont", Speed: 3.4, Hue: 0x6fd39a,
      Notes: "E4 E4 E4:1 E4 E4 E4:1 E4 G4 C4 D4 E4:2 F4 F4 F4 F4 F4 E4 E4 E4 E4 D4 D4 E4 D4:1 G4:1 " +
      "E4 E4 E4:1 E4 E4 E4:1 E4 G4 C4 D4 E4:2 F4 F4 F4 F4 F4 E4 E4 E4 G4 G4 F4 D4 C4:2",
    },
    {
      Title: "BRAHMS' LULLABY", Composer: "Brahms", Speed: 2.9, Hue: 0xb8a6ff,
      Notes: "E4 E4 G4:1.5 E4 E4 G4:1.5 E4 G4 C5:1 B4:1 A4 A4 G4:1 D4 E4 F4:1 D4 D4 E4 F4:1.5 " +
      "D4 F4 B4 A4 G4:1 B4:1 C5:2",
    },
    {
      Title: "MINUET IN G", Composer: "C. Petzold", Speed: 3.4, Hue: 0x7ed8d8,
      Notes: "D5:1 G4 A4 B4 C5 D5:1 G4:1 G4:1 E5:1 C5 D5 E5 F#5 G5:1 G4:1 G4:1 " +
      "C5:1 D5 C5 B4 A4 B4:1 C5 B4 A4 G4 F#4:1 G4 A4 B4 G4 A4:2",
    },
    {
      Title: "FÜR ELISE", Composer: "Beethoven", Speed: 3.6, Hue: 0xff8f7a,
      Notes: "E5 D#5 E5 D#5 E5 B4 D5 C5 A4:1 C4 E4 A4 B4:1 E4 G#4 B4 C5:1 E4 " +
      "E5 D#5 E5 D#5 E5 B4 D5 C5 A4:1 C4 E4 A4 B4:1 E4 C5 B4 A4:1.5",
    },
    {
      Title: "GREENSLEEVES", Composer: "Traditional", Speed: 3.2, Hue: 0x8acb5e,
      Notes: "A4 C5:1 D5 E5:0.75 F5:0.25 E5 D5:1 B4 G4:0.75 A4:0.25 B4 C5:1 A4 A4:0.75 G#4:0.25 A4 B4:1 G#4 E4:1 " +
      "A4 C5:1 D5 E5:0.75 F5:0.25 E5 D5:1 B4 G4:0.75 A4:0.25 B4 C5:0.75 B4:0.25 A4 G#4:0.75 F#4:0.25 G#4 A4:1.5",
    },
    {
      Title: "HALL OF THE MOUNTAIN KING", Composer: "Grieg", Speed: 3.8, Hue: 0xc58bff,
      Notes: "B3 C#4 D4 E4 F#4 D4 F#4:1 F4 C#4 F4:1 E4 C4 E4:1 B3 C#4 D4 E4 F#4 D4 F#4 B4 A4 F#4 D4 F#4 A4:2 " +
      "B3 C#4 D4 E4 F#4 D4 F#4:1 F4 C#4 F4:1 E4 C4 E4:1 B3 C#4 D4 E4 F#4 D4 F#4 B4 A4 F#4 D4 F#4 A4:2",
    },
  ] as Song[],

  /** Parses a song into MIDI pitches and lengths in beats. */
  Parse(song: Song, pitches: number[], beats: number[]) {
    pitches.length = 0;
    beats.length = 0;
    for (const token of song.Notes.split(" ")) {
      if (token.length === 0) continue;
      let name = token;
      let len = 0.5;
      const colon = token.indexOf(":");
      if (colon > 0) {
        name = token.substring(0, colon);
        const v = parseFloat(token.substring(colon + 1));
        len = Number.isNaN(v) ? 0 : v; // float.TryParse leaves 0 on failure
      }
      pitches.push(Midi(name));
      beats.push(len);
    }
  },
};
