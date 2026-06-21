// アプリ全体で共有する単一のシーケンスコントローラ（Tone.js）。
// 起動時に一度だけ Transport を開始し、シーン遷移では一切リセットしない。
// → どのシーンでも同じクロックを参照するため、拍の間隔にズレが生じない。
//
// - BPM 110 固定
// - シンプルなファミコン風ビート（キック4つ打ち / スネア2・4拍 / ハイハット8分）。
//   スネア・ハイハットは NES のノイズチャンネルに倣いノイズ系で鳴らす。
// - 効果音用に type: "square" の単音シンセ（playBlip）も持つ。
// - 1 拍（4分音符）ごとに onBeat を発火。2 拍ごと（偶数拍）を「プレス拍」とする
// - phase() で N 拍周期内の連続位相（0..1）を取得（ベルトの滑らかな移動などに使う）

import * as Tone from "tone";

/** 楽曲全体のテンポ。 */
export const BPM = 110;

/** 1 拍の長さ（秒）。連続位相の計算などに使う。 */
export const SEC_PER_BEAT = 60 / BPM;

export interface BeatInfo {
  /** 起動からの通し拍番号（0, 1, 2, ...）。 */
  index: number;
  /** プレス拍（2 拍ごと = 偶数拍）か。 */
  isPress: boolean;
  /** 発火したオーディオ時刻（秒）。 */
  time: number;
}

type BeatListener = (beat: BeatInfo) => void;

class SequenceController {
  private synth: Tone.Synth | null = null;
  private kick: Tone.MembraneSynth | null = null;
  private pressKick: Tone.MembraneSynth | null = null;
  private machineHit: Tone.NoiseSynth | null = null;
  private machineMetal: Tone.MetalSynth | null = null;
  private snare: Tone.NoiseSynth | null = null;
  private hat: Tone.NoiseSynth | null = null;
  /** 8 分ハイハットに重ねる裏 16 分用。Noise は start 時刻が単調増加のため hat と分離する。 */
  private busyHat: Tone.NoiseSynth | null = null;
  private bass: Tone.Synth | null = null;
  private listBass: Tone.Synth | null = null;
  private listChime: Tone.Synth | null = null;
  private scanPing: Tone.Synth | null = null;
  private started = false;
  private beatIndex = 0;
  // 視覚用（描画フレームに同期）と音用（オーディオ時刻で正確）を分離する。
  private readonly drawListeners = new Set<BeatListener>();
  private readonly audioListeners = new Set<BeatListener>();

  /**
   * 起動時に一度だけ呼ぶ。AudioContext を resume し Transport を開始する。
   * 二重に呼んでも安全（StrictMode の二重実行を許容）。
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await Tone.start();

    // 効果音用: 矩形波＋短い減衰（アタック強め・サステインなし）。
    this.synth = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 },
      volume: -12,
    }).toDestination();

    // キック: パンチのある膜シンセ（ピッチが素早く下がる）。
    this.kick = new Tone.MembraneSynth({
      octaves: 6,
      pitchDecay: 0.04,
      envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.02 },
      volume: -6,
    }).toDestination();

    // プレスキック: 送るシーンのプレス動作と同期する重低音。
    this.pressKick = new Tone.MembraneSynth({
      octaves: 8,
      pitchDecay: 0.08,
      envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.08 },
      volume: -1,
    }).toDestination();

    // プレス作動: ベルト接触時の金属スクラッチ（バンドパスで中高域を強調）。
    const machineHitFilter = new Tone.Filter({
      frequency: 3400,
      type: "bandpass",
      Q: 1.4,
    }).toDestination();
    this.machineHit = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
      volume: -14,
    }).connect(machineHitFilter);

    // プレス作動: 金属クランクの倍音リング。
    this.machineMetal = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.03 },
      harmonicity: 10,
      modulationIndex: 24,
      resonance: 5200,
      octaves: 1.1,
      volume: -12,
    }).toDestination();
    this.machineMetal.frequency.value = 260;

    // スネア: 白ノイズのバースト（NES のノイズチャンネル風）。
    this.snare = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
      volume: -14,
    }).toDestination();

    // ハイハット: 短いノイズをハイパスで通してチキッと鳴らす。
    const createHat = (): Tone.NoiseSynth => {
      const hatFilter = new Tone.Filter(8000, "highpass").toDestination();
      return new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
        volume: -22,
      }).connect(hatFilter);
    };
    this.hat = createHat();
    this.busyHat = createHat();

    // ベース: NES のベースに倣い三角波（既定では鳴らさず、シーンが addBass で追加する）。
    this.bass = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.05 },
      volume: 0,
    }).toDestination();

    // 荷物一覧: スタッカートなファンクベース（addListGroove で鳴らす）。
    this.listBass = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.003, decay: 0.14, sustain: 0.15, release: 0.04 },
      volume: -8,
    }).toDestination();

    // 荷物一覧: シンコペしたチーム（addListGroove で鳴らす）。
    this.listChime = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 },
      volume: -14,
    }).toDestination();

    // 受信: レーダー ping（addScanRadar で 8 分刻みのピコピコ）。
    this.scanPing = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.04 },
      volume: -12,
    }).toDestination();

    const transport = Tone.getTransport();
    transport.bpm.value = BPM;
    // ドラムパターン（4/4）。time はスケジュール済みオーディオ時刻。
    transport.scheduleRepeat((time) => this.kick?.triggerAttackRelease("C1", "8n", time), "4n", 0); // 4つ打ち
    transport.scheduleRepeat((time) => this.snare?.triggerAttackRelease("8n", time), "2n", "4n"); // 2・4拍
    transport.scheduleRepeat((time) => this.hat?.triggerAttackRelease("16n", time), "8n", 0); // 8分
    // 拍番号の更新・視覚イベント・効果音フックは onTick に集約（1 拍ごと）。
    transport.scheduleRepeat((time) => this.onTick(time), "4n", 0);
    transport.start();

    // ブラウザ等で起動時に resume できなかった場合の保険（初回操作で resume）。
    if (Tone.getContext().state !== "running") {
      const resume = () => void Tone.start();
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
    }
  }

  private onTick(time: number): void {
    const index = this.beatIndex++;
    // プレス拍 = 2 拍ごと（偶数拍）。ベルトのタイル到達周期と一致させる。
    const isPress = index % 2 === 0;
    const beat: BeatInfo = { index, isPress, time };

    // 音用リスナはオーディオ時刻で即時発火（効果音を鳴らしたいとき用）。
    this.audioListeners.forEach((listener) => listener(beat));

    // 視覚用リスナはオーディオ時刻に同期した描画タイミングで発火（音と映像を揃える）。
    Tone.getDraw().schedule(() => {
      this.drawListeners.forEach((listener) => listener(beat));
    }, time);
  }

  /** 拍イベント（描画フレーム同期）を購読する。返り値を呼ぶと解除。視覚演出用。 */
  onBeat(listener: BeatListener): () => void {
    this.drawListeners.add(listener);
    return () => this.drawListeners.delete(listener);
  }

  /** 拍イベント（オーディオ時刻）を購読する。返り値を呼ぶと解除。音の発火用。 */
  onBeatAudio(listener: BeatListener): () => void {
    this.audioListeners.add(listener);
    return () => this.audioListeners.delete(listener);
  }

  /**
   * beatsPerCycle 拍を 1 周期とみなした連続位相（0..1）。
   * Transport の現在時刻から算出するので、フレーム毎に読めば滑らかに進む。
   */
  phase(beatsPerCycle: number): number {
    const cycle = SEC_PER_BEAT * beatsPerCycle;
    const sec = Tone.getTransport().seconds;
    return (sec % cycle) / cycle;
  }

  /** Transport の現在秒（連続・単調増加）。巻き戻らない連続スクロール等に使う。 */
  nowSeconds(): number {
    return Tone.getTransport().seconds;
  }

  /**
   * ファミコン風 square blip を鳴らす。
   * time を渡すとそのオーディオ時刻にスケジュールする（onBeatAudio の beat.time を渡す）。
   */
  playBlip(note = "C5", duration = "16n", time?: number): void {
    this.synth?.triggerAttackRelease(note, duration, time);
  }

  /**
   * 送るシーンのプレス落下と同期する重低音。
   * time を渡すと指定オーディオ時刻へスケジュール（onBeatAudio の beat.time と揃える）。
   */
  playPressKick(time?: number): void {
    this.pressKick?.triggerAttackRelease("G0", "4n", time);
  }

  /** 送るシーンのプレス作動音（ベルト接触）。重低音＋金属スクラッチ＋クランク。 */
  playMachineImpact(time?: number): void {
    const t = time ?? Tone.now();
    this.pressKick?.triggerAttackRelease("G0", "8n", t);
    this.machineHit?.triggerAttackRelease("32n", t);
    if (this.machineMetal) {
      this.machineMetal.frequency.value = 200 + Math.random() * 160;
      this.machineMetal.triggerAttackRelease("32n", t);
    }
  }

  /** Transport に繰り返しイベントを追加し、解除関数を返す汎用ヘルパ。 */
  private scheduleLayer(
    callback: (time: number) => void,
    interval: string,
    startTime: string | number = 0,
  ): () => void {
    const id = Tone.getTransport().scheduleRepeat(callback, interval, startTime);
    return () => Tone.getTransport().clear(id);
  }

  /** 現在のオーディオ時刻における通し拍番号（小節グリッドに揃える用）。 */
  private beatAt(time: number): number {
    const transport = Tone.getTransport();
    return Math.round(transport.getTicksAtTime(time) / transport.PPQ);
  }

  /** 8 分音符グリッド上の通しステップ番号。 */
  private eighthAt(time: number): number {
    const transport = Tone.getTransport();
    return Math.round(transport.getTicksAtTime(time) / (transport.PPQ / 2));
  }

  /** 16 分音符グリッド上の通しステップ番号。 */
  private sixteenthAt(time: number): number {
    const transport = Tone.getTransport();
    return Math.round(transport.getTicksAtTime(time) / (transport.PPQ / 4));
  }

  /**
   * ベースライン（簡単な 8 拍リフ）を追加する。解除関数を返す。
   * 拍番号を Transport の絶対グリッドから算出するので、いつ追加しても小節に揃う。
   */
  addBass(): () => void {
    const riff = ["C2", "C2", "G1", "A1", "C2", "C2", "E2", "G2"];
    return this.scheduleLayer((time) => {
      const note = riff[this.beatAt(time) % riff.length];
      this.bass?.triggerAttackRelease(note, "8n", time);
    }, "4n");
  }

  /**
   * ハイハットを 16 分に増やす（既定の 8 分の隙間=裏 16 分を追加）。解除関数を返す。
   */
  addBusyHats(): () => void {
    return this.scheduleLayer(
      (time) => this.busyHat?.triggerAttackRelease("32n", time),
      "16n",
      "16n",
    );
  }

  /**
   * 受信シーン向けレーダー音。
   * 0.5 拍（8 分）ごとにピコピコ。小節頭だけ高く、以降は少し下げて一定。
   * 小節後半（3・4 拍目）の 8 分の隙間に 16 分を追加して密度を上げる。
   */
  addScanRadar(): () => void {
    const highNote = "G5";
    const lowNote = "D5";

    const remove8n = this.scheduleLayer((time) => {
      const step = this.eighthAt(time) % 8;
      const note = step === 0 ? highNote : lowNote;
      this.scanPing?.triggerAttackRelease(note, "32n", time);
    }, "8n");

    const remove16n = this.scheduleLayer((time) => {
      const step = this.sixteenthAt(time) % 16;
      // 3・4 拍目（16 分 8〜15）の裏 16 分だけ鳴らす（8 分と被らない）。
      if (step < 8 || step % 2 === 0) return;
      this.scanPing?.triggerAttackRelease(lowNote, "32n", time);
    }, "16n");

    return () => {
      remove8n();
      remove16n();
    };
  }

  /**
   * 荷物一覧向けのグルーヴ一式。
   * 8 分ファンクベース + シンコペチーム + 2・4 拍スタブ + 16 分ハイハット + スウィング。
   * 8 ステップ = 4/4 の 1 小節。キック 4 つ打ち・棚 4 箱巡回と揃える。
   */
  addListGroove(): () => void {
    const transport = Tone.getTransport();
    const prevSwing = transport.swing;
    const prevSwingSub = transport.swingSubdivision;
    transport.swing = 0.12;
    transport.swingSubdivision = "8n";

    // 8 分グリッド・8 ステップ = 4/4 一連の符。
    const bassLine: (string | null)[] = ["C2", null, "C2", "E2", null, "G2", "G2", "A1"];
    const chimeLine: (string | null)[] = [null, null, "G4", null, "C5", null, "E4", null];

    const removeBass = this.scheduleLayer((time) => {
      const note = bassLine[this.eighthAt(time) % bassLine.length];
      if (note) this.listBass?.triggerAttackRelease(note, "16n", time);
    }, "8n");

    const removeChime = this.scheduleLayer((time) => {
      const note = chimeLine[this.eighthAt(time) % chimeLine.length];
      if (note) this.listChime?.triggerAttackRelease(note, "16n", time);
    }, "8n");

    const removeStab = this.scheduleLayer((time) => this.playBlip("G3", "16n", time), "2n", "4n");

    const removeHats = this.addBusyHats();

    return () => {
      removeBass();
      removeChime();
      removeStab();
      removeHats();
      transport.swing = prevSwing;
      transport.swingSubdivision = prevSwingSub;
    };
  }
}

let singleton: SequenceController | null = null;

/** アプリ共有の単一インスタンスを取得する。 */
export function getSequence(): SequenceController {
  singleton ??= new SequenceController();
  return singleton;
}

export type { SequenceController };
