import { Mathf, SysRandom, V2, V2i } from "../../kit";

/** One legal move (C# struct LudoMove; `new LudoMove()` is C#'s `default`, all zeros). */
export class LudoMove {
  Player = 0;
  TokenIndex = 0;
  FromStep = 0;
  ToStep = 0;
  Roll = 0;
  CapturedPlayer = 0;
  CapturedTokenIndex = 0;
  CapturedFromStep = 0;
  constructor(init?: Partial<LudoMove>) { if (init) Object.assign(this, init); }

  get LeavesYard() { return this.FromStep === LudoBoard.YardStep; }
  get ReachesGoal() { return this.ToStep === LudoBoard.GoalStep; }
  get HasCapture() { return this.CapturedPlayer >= 0; }
  get GrantsBonusRoll() { return this.Roll === 6 || this.ReachesGoal || this.HasCapture; }
}

export interface StageSpec {
  StageNumber: number;
  ArenaName: string;
  Subtitle: string;
  ActiveSeats: number[]; // Always includes 0 (You). E.g. [0, 2] for 1v1, [0, 1, 2] for 3P, [0, 1, 2, 3] for 4P.
  RivalNames: string[]; // Names for seats 1, 2, 3
  AiSkill: number; // 0.15 .. 1.0
  DefaultTokensOut: number;
  WinCoins: number;
}

const v = (x: number, y: number) => new V2i(x, y);

/**
 * Classic 15x15 cross-shaped Ludo board geometry, pure rules engine, tournament stage specs, and tactical AI.
 * Grid coordinates are (0..14, 0..14) with (7, 7) at the center of the 3x3 Crown Goal. (Port of LudoRules.cs.)
 */
export const LudoBoard = {
  GridSize: 15,
  PlayerCount: 4,
  TokensPerPlayer: 4,
  TrackLength: 52,
  HomeEntryStep: 50, // Steps 0..50 are on the 52-tile outer perimeter; 51..55 are Home Column; 56 is Crown Goal.
  GoalStep: 56,
  YardStep: -1,

  // 52-square clockwise outer perimeter starting at Player 0's (Red, Bottom-Left) Start Square (6, 1).
  TrackCoords: [
    // Bottom arm left column going UP (0..4)
    v(6, 1), v(6, 2), v(6, 3), v(6, 4), v(6, 5),
    // Left arm bottom row going LEFT (5..10)
    v(5, 6), v(4, 6), v(3, 6), v(2, 6), v(1, 6), v(0, 6),
    // Left tip (11)
    v(0, 7),
    // Left arm top row going RIGHT (12..17) — index 13 is Player 1 (Green) Start Square (1, 8)
    v(0, 8), v(1, 8), v(2, 8), v(3, 8), v(4, 8), v(5, 8),
    // Top arm left column going UP (18..23)
    v(6, 9), v(6, 10), v(6, 11), v(6, 12), v(6, 13), v(6, 14),
    // Top tip (24)
    v(7, 14),
    // Top arm right column going DOWN (25..30) — index 26 is Player 2 (Gold) Start Square (8, 13)
    v(8, 14), v(8, 13), v(8, 12), v(8, 11), v(8, 10), v(8, 9),
    // Right arm top row going RIGHT (31..36)
    v(9, 8), v(10, 8), v(11, 8), v(12, 8), v(13, 8), v(14, 8),
    // Right tip (37)
    v(14, 7),
    // Right arm bottom row going LEFT (38..43) — index 39 is Player 3 (Blue) Start Square (13, 6)
    v(14, 6), v(13, 6), v(12, 6), v(11, 6), v(10, 6), v(9, 6),
    // Bottom arm right column going DOWN (44..49)
    v(8, 5), v(8, 4), v(8, 3), v(8, 2), v(8, 1), v(8, 0),
    // Bottom tip (50) and bottom-left corner (51)
    v(7, 0), v(6, 0),
  ],

  StartTrackIndices: [0, 13, 26, 39],
  StarTrackIndices: [8, 21, 34, 47],

  StartTrackIndex: (player: number) => (player & 3) * 13,

  StepToTrackIndex(player: number, step: number) {
    if (step < 0 || step > LudoBoard.HomeEntryStep) return -1;
    return (player * 13 + step) % LudoBoard.TrackLength;
  },

  /** Returns the owner of a start tile, or -1 (C# `out int owner`). */
  IsStartTrack(trackIdx: number): [boolean, number] {
    if (trackIdx >= 0 && trackIdx < LudoBoard.TrackLength && trackIdx % 13 === 0) return [true, Math.trunc(trackIdx / 13)];
    return [false, -1];
  },

  IsStarTrack: (trackIdx: number) => trackIdx === 8 || trackIdx === 21 || trackIdx === 34 || trackIdx === 47,

  IsSafeTrack: (trackIdx: number) =>
    trackIdx === 0 || trackIdx === 8 || trackIdx === 13 || trackIdx === 21 ||
    trackIdx === 26 || trackIdx === 34 || trackIdx === 39 || trackIdx === 47,

  HomeStretchCoord(player: number, step: number) {
    const k = Mathf.clamp(step - LudoBoard.HomeEntryStep, 1, 5); // 1..5
    switch (player & 3) {
      case 0: return new V2i(7, k);          // Bottom arm going UP to center
      case 1: return new V2i(k, 7);          // Left arm going RIGHT to center
      case 2: return new V2i(7, 14 - k);     // Top arm going DOWN to center
      default: return new V2i(14 - k, 7);    // Right arm going LEFT to center
    }
  },

  YardCenterGrid(player: number) {
    switch (player & 3) {
      case 0: return new V2(2.5, 2.5);   // Bottom-Left (Ruby Red)
      case 1: return new V2(2.5, 11.5);  // Top-Left (Emerald Green)
      case 2: return new V2(11.5, 11.5); // Top-Right (Amber Gold)
      default: return new V2(11.5, 2.5); // Bottom-Right (Electric Blue)
    }
  },

  YardSlotGrid(player: number, tokenIndex: number) {
    const c = LudoBoard.YardCenterGrid(player);
    const dx = (tokenIndex & 1) === 0 ? -1.12 : 1.12;
    const dy = tokenIndex < 2 ? 1.12 : -1.12;
    return new V2(c.x + dx, c.y + dy);
  },

  GoalSlotGrid(player: number, tokenIndex: number) {
    const spread = (tokenIndex - 1.5) * 0.36;
    switch (player & 3) {
      case 0: return new V2(7 + spread, 6.18);
      case 1: return new V2(6.18, 7 + spread);
      case 2: return new V2(7 - spread, 7.82);
      default: return new V2(7.82, 7 - spread);
    }
  },

  StepToGridPos(player: number, step: number, tokenIndex: number) {
    if (step === LudoBoard.YardStep) return LudoBoard.YardSlotGrid(player, tokenIndex);
    if (step >= LudoBoard.GoalStep) return LudoBoard.GoalSlotGrid(player, tokenIndex);
    if (step > LudoBoard.HomeEntryStep) {
      const hc = LudoBoard.HomeStretchCoord(player, step);
      return new V2(hc.x, hc.y);
    }
    const track = LudoBoard.StepToTrackIndex(player, step);
    const tc = LudoBoard.TrackCoords[track];
    return new V2(tc.x, tc.y);
  },

  GetStage(level: number): StageSpec {
    const lv = Math.max(1, level);
    const s = (ArenaName: string, Subtitle: string, ActiveSeats: number[], RivalNames: string[], AiSkill: number, DefaultTokensOut: number, WinCoins: number): StageSpec =>
      ({ StageNumber: lv, ArenaName, Subtitle, ActiveSeats, RivalNames, AiSkill, DefaultTokensOut, WinCoins });
    switch ((lv - 1) % 12) {
      case 0: return s("NEON CLUB", "1v1 BLITZ DUEL", [0, 2], ["NOVA", "VEX", "KAI"], 0.25, 2, 100);
      case 1: return s("STARLIGHT PLAZA", "1v1 SHOWDOWN", [0, 2], ["NOVA", "ECHO", "KAI"], 0.38, 2, 115);
      case 2: return s("TRIAD CIRCUIT", "3-PLAYER CLASH", [0, 1, 2], ["LYRA", "VEX", "KAI"], 0.48, 2, 135);
      case 3: return s("RUBY ARENA", "TACTICAL DUEL", [0, 2], ["NOVA", "ZARA", "KAI"], 0.56, 1, 150);
      case 4: return s("ROYAL QUADS", "4-PLAYER ROYALE", [0, 1, 2, 3], ["NOVA", "ZARA", "KAI"], 0.62, 2, 180);
      case 5: return s("SOLAR CITADEL", "3-PLAYER CLASH", [0, 1, 3], ["ORION", "ZARA", "BLITZ-9"], 0.68, 1, 195);
      case 6: return s("QUANTUM RING", "4-PLAYER ROYALE", [0, 1, 2, 3], ["ZARA", "ORION", "VALKYRIE"], 0.75, 1, 210);
      case 7: return s("VALKYRIE COURT", "1v1 MASTER DUEL", [0, 2], ["ORION", "VALKYRIE", "APEX"], 0.82, 1, 225);
      case 8: return s("HYPERION NEXUS", "3-PLAYER ELITE", [0, 1, 2], ["VALKYRIE", "APEX", "SOVEREIGN"], 0.88, 1, 240);
      case 9: return s("ECLIPSE CHAMBERS", "4-PLAYER ROYALE", [0, 1, 2, 3], ["BLITZ-9", "VALKYRIE", "APEX"], 0.92, 1, 260);
      case 10: return s("APEX SANCTUM", "1v1 GRAND DUEL", [0, 2], ["VALKYRIE", "SOVEREIGN", "APEX"], 0.96, 1, 280);
      default: return s("GRAND CROWN FINALS", "4-PLAYER CHAMPIONSHIP", [0, 1, 2, 3], ["VALKYRIE", "SOVEREIGN", "APEX"], 1.0, 1, 320);
    }
  },
};

export class LudoState {
  readonly ActivePlayers: boolean[] = new Array(LudoBoard.PlayerCount).fill(false);
  /** Steps[player][token] (C# int[,]). */
  readonly Steps: number[][] = Array.from({ length: LudoBoard.PlayerCount }, () => new Array(LudoBoard.TokensPerPlayer).fill(0));
  CurrentTurn = 0;
  ConsecutiveSixes = 0;
  TurnCounter = 0;

  InitMatch(activeSeats: number[], startTokensOut: number) {
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      this.ActivePlayers[p] = false;
      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++)
        this.Steps[p][t] = LudoBoard.YardStep;
    }

    for (let i = 0; i < activeSeats.length; i++) {
      const p = activeSeats[i] & 3;
      this.ActivePlayers[p] = true;
      const outCount = Mathf.clamp(startTokensOut, 0, LudoBoard.TokensPerPlayer);
      for (let t = 0; t < outCount; t++)
        this.Steps[p][t] = 0; // Placed on player's safe Start Square
    }

    this.CurrentTurn = 0;
    this.ConsecutiveSixes = 0;
    this.TurnCounter = 0;
  }

  HomeCount(player: number) {
    let c = 0;
    for (let t = 0; t < LudoBoard.TokensPerPlayer; t++)
      if (this.Steps[player][t] === LudoBoard.GoalStep) c++;
    return c;
  }

  YardCount(player: number) {
    let c = 0;
    for (let t = 0; t < LudoBoard.TokensPerPlayer; t++)
      if (this.Steps[player][t] === LudoBoard.YardStep) c++;
    return c;
  }

  HasPlayerWon(player: number) { return this.ActivePlayers[player] && this.HomeCount(player) === LudoBoard.TokensPerPlayer; }

  TotalProgressPercent(player: number) {
    let sum = 0;
    for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
      const s = this.Steps[player][t];
      if (s >= 0) sum += s + 1;
    }
    return Mathf.roundToInt((sum * 100) / (LudoBoard.TokensPerPlayer * (LudoBoard.GoalStep + 1)));
  }

  NextActivePlayer(fromPlayer: number) {
    for (let i = 1; i <= LudoBoard.PlayerCount; i++) {
      const p = (fromPlayer + i) % LudoBoard.PlayerCount;
      if (this.ActivePlayers[p]) return p;
    }
    return 0;
  }

  GetLegalMoves(player: number, roll: number, results: LudoMove[]) {
    results.length = 0;
    if (!this.ActivePlayers[player] || roll < 1 || roll > 6) return;

    for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
      const s = this.Steps[player][t];
      if (s === LudoBoard.GoalStep) continue;

      if (s === LudoBoard.YardStep) {
        if (roll === 6) {
          results.push(new LudoMove({
            Player: player, TokenIndex: t, FromStep: LudoBoard.YardStep, ToStep: 0, Roll: roll,
            CapturedPlayer: -1, CapturedTokenIndex: -1, CapturedFromStep: -1,
          }));
        }
        continue;
      }

      const dest = s + roll;
      if (dest > LudoBoard.GoalStep) continue; // Exact roll needed for Goal

      let cap = [-1, -1, -1];
      if (dest <= LudoBoard.HomeEntryStep) {
        const destTrack = LudoBoard.StepToTrackIndex(player, dest);
        if (!LudoBoard.IsSafeTrack(destTrack)) cap = this.FindCaptureTarget(player, destTrack);
      }

      results.push(new LudoMove({
        Player: player, TokenIndex: t, FromStep: s, ToStep: dest, Roll: roll,
        CapturedPlayer: cap[0], CapturedTokenIndex: cap[1], CapturedFromStep: cap[2],
      }));
    }
  }

  /** Returns [capPlayer, capToken, capStep] (C# out params). */
  private FindCaptureTarget(moverPlayer: number, trackIndex: number) {
    let capPlayer = -1, capToken = -1, capStep = -1;
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      if (p === moverPlayer || !this.ActivePlayers[p]) continue;
      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
        const s = this.Steps[p][t];
        if (s < 0 || s > LudoBoard.HomeEntryStep) continue;
        if (LudoBoard.StepToTrackIndex(p, s) === trackIndex) {
          // Prefer capturing the opponent token furthest along its journey
          if (s > capStep) {
            capPlayer = p;
            capToken = t;
            capStep = s;
          }
        }
      }
    }
    return [capPlayer, capToken, capStep];
  }

  ApplyMove(move: LudoMove) {
    this.Steps[move.Player][move.TokenIndex] = move.ToStep;
    if (move.HasCapture) this.Steps[move.CapturedPlayer][move.CapturedTokenIndex] = LudoBoard.YardStep;
  }

  /** Counts how many enemy tokens are 1..6 steps behind trackIndex (able to capture on their next roll). */
  CountEnemyThreatsBehind(ownerPlayer: number, trackIndex: number) {
    if (trackIndex < 0 || LudoBoard.IsSafeTrack(trackIndex)) return 0;
    let threats = 0;
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      if (p === ownerPlayer || !this.ActivePlayers[p]) continue;
      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
        const s = this.Steps[p][t];
        if (s < 0 || s > LudoBoard.HomeEntryStep) continue;
        const enemyTrack = LudoBoard.StepToTrackIndex(p, s);
        const dist = (trackIndex - enemyTrack + LudoBoard.TrackLength) % LudoBoard.TrackLength;
        if (dist >= 1 && dist <= 6 && s + dist <= LudoBoard.HomeEntryStep) threats++;
      }
    }
    return threats;
  }
}

export const LudoAi = {
  ChooseMove(state: LudoState, legalMoves: LudoMove[], skill: number, rng: SysRandom): LudoMove {
    if (legalMoves.length === 0) return new LudoMove();
    if (legalMoves.length === 1) return legalMoves[0];

    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < legalMoves.length; i++) {
      const m = legalMoves[i];
      let score = LudoAi.EvaluateMove(state, m, skill);
      // Add slight tie-breaking jitter (larger at low skill levels)
      const jitter = rng.nextDouble() * Mathf.lerp(28, 3.5, skill);
      score += jitter;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return legalMoves[bestIdx];
  },

  EvaluateMove(state: LudoState, m: LudoMove, skill: number) {
    let score = 0;

    // 1. Capturing an opponent token is huge (sends them to yard + grants extra roll)
    if (m.HasCapture) {
      score += 145 + m.CapturedFromStep * 1.6;
      if (m.CapturedPlayer === 0) score += 18 * skill; // Rivals love challenging the player
    }

    // 2. Reaching the center Crown Goal (locks token + grants extra roll)
    if (m.ReachesGoal) score += 125;

    // 3. Leaving the yard on a 6 to deploy more tokens
    if (m.LeavesYard) {
      let activeOnTrack = 0;
      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
        const s = state.Steps[m.Player][t];
        if (s >= 0 && s < LudoBoard.GoalStep) activeOnTrack++;
      }
      score += activeOnTrack === 0 ? 130 : activeOnTrack === 1 ? 95 : 65;
    }

    // 4. Crossing from vulnerable outer track into safe Home Stretch (51..55)
    if (m.FromStep >= 0 && m.FromStep <= LudoBoard.HomeEntryStep && m.ToStep > LudoBoard.HomeEntryStep) score += 82;

    // 5. Threat & Safety analysis on the outer track
    const fromTrack = LudoBoard.StepToTrackIndex(m.Player, m.FromStep);
    const toTrack = LudoBoard.StepToTrackIndex(m.Player, m.ToStep);

    if (fromTrack >= 0) {
      const currentThreats = state.CountEnemyThreatsBehind(m.Player, fromTrack);
      if (currentThreats > 0) {
        // Escaping an immediate enemy threat!
        score += 58 * currentThreats * Mathf.lerp(0.4, 1.15, skill);
      } else if (LudoBoard.IsSafeTrack(fromTrack)) {
        // Slight reluctance to leave a safe tile unless capturing or advancing late
        score -= 22 * skill;
      }
    }

    if (toTrack >= 0) {
      if (LudoBoard.IsSafeTrack(toTrack)) {
        score += 48 * Mathf.lerp(0.5, 1.1, skill);
      } else {
        const destThreats = state.CountEnemyThreatsBehind(m.Player, toTrack);
        if (destThreats > 0) {
          // Walking into enemy range!
          score -= 64 * destThreats * Mathf.lerp(0.3, 1.2, skill);
        }

        // Bonus for stalking 1..6 tiles behind an exposed opponent token
        for (let p = 0; p < LudoBoard.PlayerCount; p++) {
          if (p === m.Player || !state.ActivePlayers[p]) continue;
          for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
            const es = state.Steps[p][t];
            if (es < 0 || es > LudoBoard.HomeEntryStep) continue;
            const eTrack = LudoBoard.StepToTrackIndex(p, es);
            if (LudoBoard.IsSafeTrack(eTrack)) continue;
            const ahead = (eTrack - toTrack + LudoBoard.TrackLength) % LudoBoard.TrackLength;
            if (ahead >= 1 && ahead <= 6) score += 20 * skill;
          }
        }
      }
    }

    // 6. General forward advancement
    if (m.FromStep >= 0) score += m.ToStep * 0.75;

    return score;
  },
};
