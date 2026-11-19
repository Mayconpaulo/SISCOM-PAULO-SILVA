export type CartaoModel = 'boas_vindas' | 'aniversario' | 'pesames';

export const CARTOES_ASSETS = {
  marcaDagua: '/assets/cartoes/marca_dagua.png',
  brasaoRepublica: '/assets/cartoes/brasao_republica.png',
  distintivo1BiMec: '/assets/cartoes/distintivo_1bimec.png',
  distintivoFeb: '/assets/cartoes/distintivo_feb.png',
  brasaoExercitoFita: '/assets/cartoes/brasao_exercito_fita.png',
  assinaturaCmt: '/assets/cartoes/assinatura_cmt.png',
} as const;

export const CARTAO_ASSET_RATIOS = {
  marcaDagua: 713 / 538,
  brasaoRepublica: 131 / 131,
  distintivo1BiMec: 295 / 409,
  distintivoFeb: 130 / 155,
  brasaoExercitoFita: 340 / 576,
  assinaturaCmt: 293 / 240,
} as const;

export interface JustifiedWord {
  text: string;
  xOffsetMm: number;
}

export interface FittedBodyLine {
  words: JustifiedWord[];
  isLastInParagraph: boolean;
  rawText: string;
}

export interface FittedBodyText {
  lines: FittedBodyLine[];
  fontSizeMm: number;
  lineHeightMm: number;
}
