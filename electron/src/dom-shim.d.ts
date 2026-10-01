// `src/i18n/index.ts` (importowany też przez proces główny) dotyka `document` tylko za strażnikiem `typeof`.
declare var document: { documentElement: { lang: string } };
