export interface ProgramAccentTheme {
  primary: string;
  hover: string;
  active: string;
  subtle: string;
  foreground: string;
  text: string;
  onDark: string;
  darkSurface: string;
  darkInteractive: string;
  darkInteractiveForeground: string;
}

export const DEFAULT_PROGRAM_ACCENT_THEME: ProgramAccentTheme = {
  primary: '#c99a3b',
  hover: '#b8862e',
  active: '#98731b',
  subtle: '#fff8e2',
  foreground: '#2e2812',
  text: '#8a6718',
  onDark: '#f7d774',
  darkSurface: '#3b2d0d',
  darkInteractive: '#c99a3b',
  darkInteractiveForeground: '#17120a',
};

export const PROGRAM_ACCENT_THEMES: Record<string, ProgramAccentTheme> = {
  CCIT: {
    primary: '#1c7d4f',
    hover: '#176d48',
    active: '#115437',
    subtle: '#e5f8ee',
    foreground: '#ffffff',
    text: '#176d48',
    onDark: '#8ae0b7',
    darkSurface: '#123527',
    darkInteractive: '#238a5a',
    darkInteractiveForeground: '#ffffff',
  },
  CTE: {
    primary: '#10213f',
    hover: '#071225',
    active: '#02040a',
    subtle: '#e8eef5',
    foreground: '#ffffff',
    text: '#10213f',
    onDark: '#9fc1e8',
    darkSurface: '#14243b',
    darkInteractive: '#315f98',
    darkInteractiveForeground: '#ffffff',
  },
  CBAPA: {
    primary: '#7d1f2d',
    hover: '#651824',
    active: '#4a0d19',
    subtle: '#fbe6ea',
    foreground: '#ffffff',
    text: '#7d1f2d',
    onDark: '#ee9aa6',
    darkSurface: '#3b1720',
    darkInteractive: '#8e2d3d',
    darkInteractiveForeground: '#ffffff',
  },
};

export const getProgramAccentTheme = (program?: string | null): ProgramAccentTheme => {
  const normalizedProgram = program?.trim().toUpperCase() || '';
  return PROGRAM_ACCENT_THEMES[normalizedProgram] || DEFAULT_PROGRAM_ACCENT_THEME;
};
