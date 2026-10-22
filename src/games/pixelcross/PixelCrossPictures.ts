import { Color, Pal } from "../../kit";

/**
 * Hand-drawn pixel pictures for the first levels (after them, symmetric pictures are generated). Each row is a
 * string; '.' is empty, a letter is a filled cell and picks its colour after the puzzle is solved.
 * (Port of PixelCrossPictures.cs.)
 */
export interface Pic { Name: string; Rows: string[] }

export const PixelCrossPictures = {
  All: [
    { Name: "HEART", Rows: ["rr.rr", "rrrrr", "rrrrr", ".rrr.", "..r.."] },
    { Name: "TREE", Rows: ["..g..", ".ggg.", "ggggg", "..n..", "..n.."] },
    { Name: "SMILE", Rows: [".yyy.", "ykyky", "yyyyy", "ykkky", ".yyy."] },
    { Name: "HOUSE", Rows: ["..r..", ".rrr.", "rrrrr", ".lnl.", ".wnw."] },
    { Name: "MUSHROOM", Rows: [".rrr.", "rwrwr", "rrrrr", ".www.", ".www."] },
    { Name: "SAILBOAT", Rows: ["..w..", ".ww..", "www..", "..n..", "nnnnn"] },
    { Name: "CAT", Rows: ["o......o", "oo....oo", "oooooooo", "okooooko", "oooooooo", "oooppooo", ".oooooo.", "..oooo.."] },
    { Name: "APPLE", Rows: ["....nd..", "..rrnrr.", ".rrrrrr.", "rwrrrrrr", "rrrrrrrr", "rrrrrrrr", ".rrrrrr.", "..rr.rr."] },
    { Name: "STAR", Rows: ["...yy...", "...yy...", "yyyyyyyy", ".yyyyyy.", "..yyyy..", ".yyyyyy.", ".yy..yy.", "y......y"] },
    { Name: "DUCK", Rows: ["..yyy...", ".yykyy..", ".yyyyoo.", "..yyy...", "yyyyyyy.", "yyyyyyyy", ".yyyyyy.", "..llll.."] },
    { Name: "GHOST", Rows: ["..vvvv..", ".vvvvvv.", "vkvvvvkv", "vkvvvvkv", "vvvvvvvv", "vvvvvvvv", "vvvvvvvv", "v.vv.vv."] },
    { Name: "ROCKET", Rows: ["...rr...", "..wwww..", "..wllw..", "..wwww..", "..wwww..", ".rwwwwr.", "rr.oo.rr", "...oo..."] },
    { Name: "UMBRELLA", Rows: ["...pp...", ".pppppp.", "pppppppp", "...n....", "...n....", "...n....", "...n.n..", "....n..."] },
    { Name: "CACTUS", Rows: ["...gg...", "...gg.g.", "g..gg.g.", "g..gggg.", "gggg....", "...gg...", "..nnnn..", ".nnnnnn."] },
    { Name: "ICE CREAM", Rows: ["..pppp..", ".pppppp.", "pppwpppp", ".pppppp.", ".nnnnnn.", "..nnnn..", "...nn...", "...nn..."] },
    { Name: "CROWN", Rows: ["y...yy...y", "yy..yy..yy", "yyy.yy.yyy", "yyyyyyyyyy", "yryybbyyry", "yyyyyyyyyy", "oooooooooo"] },
    { Name: "SUN", Rows: ["y...yy...y", ".y.yyyy.y.", "..yyooyy..", ".yyooooyy.", "yyyooooyyy", "yyyooooyyy", ".yyooooyy.", "..yyooyy..", ".y.yyyy.y.", "y...yy...y"] },
    { Name: "BIG HEART", Rows: [".rr....rr.", "rrrr..rrrr", "rrrrrrrrrr", "rwrrrrrrrr", "rrrrrrrrrr", ".rrrrrrrr.", "..rrrrrr..", "...rrrr...", "....rr...."] },
    { Name: "CAR", Rows: ["..rrrrr...", ".rllrllr..", "rrrrrrrrrr", "rrrrrrrrry", ".kk....kk.", ".kk....kk."] },
    { Name: "ROBOT", Rows: ["....rr....", "....kk....", "..llllll..", ".llllllll.", ".lkllllkl.", ".llllllll.", ".llkkkkll.", "..llllll..", "l.llllll.l", "..ll..ll.."] },
    { Name: "OWL", Rows: [".n......n.", ".nn....nn.", ".nnnnnnnn.", "nwwnnnnwwn", "wkwnnnnwkw", "nwwnnnnwwn", "nnnnoonnnn", "nnnnnnnnnn", ".nnnnnnnn.", "..o.nn.o.."] },
    { Name: "BUTTERFLY", Rows: ["vv......vv", "vvv....vvv", "vpvv..vvpv", "vvvvkkvvvv", ".vvvkkvvv.", "..vvkkvv..", ".vvvkkvvv.", "vpv.kk.vpv", ".v..kk..v."] },
  ] as Pic[],

  ColorOf(c: string): Color {
    switch (c) {
      case "r": return Pal.hex(0xf2465e);
      case "o": return Pal.hex(0xff9a2e);
      case "y": return Pal.hex(0xffd23f);
      case "g": return Pal.hex(0x4cc85c);
      case "d": return Pal.hex(0x2e8b47);
      case "b": return Pal.hex(0x3f7cf5);
      case "l": return Pal.hex(0x8ccbff);
      case "p": return Pal.hex(0xff8fc6);
      case "v": return Pal.hex(0x9b6bff);
      case "k": return Pal.hex(0x2b2b3a);
      case "w": return Pal.hex(0xf2f2f2);
      case "n": return Pal.hex(0x9a6236);
      default: return Pal.hex(0x5a6cff);
    }
  },
};
