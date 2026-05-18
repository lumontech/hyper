// Strategie Hyperliquid documentate online — knowledge base curata dai principali forum/repo:
//   - Hyperliquid Docs (gitbook)
//   - Chainstack tutorial funding-rate arbitrage
//   - BitMEX research blog
//   - GoodCryptoX / OctoBot / 3Commas / WunderTrading
//   - GitHub: HL-Delta, hyperliquid-grid-bot, passivbot, Novus-Tech HL-Market-Maker
//   - Reddit + Databird Business Journal
//
// Queste NON sono implementate nel bot — sono reference per orientare i prossimi sviluppi.
// Ogni voce indica: tipologia, expected metric, capitale minimo, complessità,
// edge structurale (cioè perché funziona o dovrebbe funzionare), fonte primaria.

export type ComplexityLevel = 'low' | 'medium' | 'high' | 'extreme'
export type EdgeType = 'structural' | 'statistical' | 'speed' | 'discretionary'
export type CapitalTier = 'micro' | 'small' | 'medium' | 'large'  // <500 / 500-5k / 5-50k / 50k+

export interface OnlineStrategy {
  id: string
  name: string
  icon: string
  category: 'arbitrage' | 'market-making' | 'directional' | 'mean-reversion' | 'delta-neutral' | 'specialty'
  shortDesc: string
  longDesc: string
  expectedReturn: string         // es "0.5-2% / month"
  expectedWR?: string
  complexity: ComplexityLevel
  edgeType: EdgeType
  capital: CapitalTier
  pros: string[]
  cons: string[]
  bestFor: string
  recommendedTF?: string
  sources: Array<{ label: string; url: string }>
}

export const ONLINE_STRATEGIES: OnlineStrategy[] = [
  // ────────────────────────────────────────────────────────────────────
  // FUNDING-RATE BASED
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'funding-rate-arb',
    name: 'Spot–Perp Funding Rate Arbitrage',
    icon: '⚖️',
    category: 'arbitrage',
    shortDesc: 'Long spot + short perp quando funding > 0 → incasso il funding payment delta-neutral.',
    longDesc: `La strategia più documentata e profittevole su Hyperliquid. Apri long sul mercato spot dell'asset (BTC, ETH, SOL) e contemporaneamente short di pari size sulla perp. Il prezzo non conta — sei delta-neutral. Quando il funding rate è positivo, lo shortista incassa pagamenti orari (HL paga funding ogni ora). Quando funding è negativo si inverte (long perp + short spot, ma su HL lo short spot non è banale). Solo BTC/ETH/SOL hanno liquidità spot+perp sufficiente su HL.`,
    expectedReturn: '0.5–2% / month (annualized 6–25%)',
    complexity: 'medium',
    edgeType: 'structural',
    capital: 'medium',
    pros: [
      'Delta-neutral (zero exposure al prezzo)',
      'Edge reale, non dipende da previsione mercato',
      'Scala con capitale',
      'Risk principale: liquidation se leverage troppo alto (≤5x raccomandato)',
    ],
    cons: [
      'Funding rate < 0.11%/h significa fee mangia il profitto',
      'Esposizione a smart-contract risk (Hyperliquid stesso)',
      'Approccio tattico (entra 10–15min pre-funding) richiede tight spread',
      'Solo 3–4 asset hanno liquidità sufficiente',
    ],
    bestFor: 'Capitale paziente che vuole rendimento decorrelato dal mercato',
    recommendedTF: 'event-driven (funding payments orari)',
    sources: [
      { label: 'Chainstack: Spot–Perp funding arbitrage tutorial', url: 'https://docs.chainstack.com/docs/hyperliquid-funding-rate-arbitrage' },
      { label: 'BitMEX Blog: Harvest funding payments', url: 'https://www.bitmex.com/blog/harvest-funding-payments-on-hyperliquid' },
      { label: 'MEXC: Hyperliquid funding rate strategy', url: 'https://www.mexc.com/learn/article/hyperliquid-funding-rate-strategy-earning-passive-income-in-2026/1' },
      { label: 'GitHub: ksmit323/funding-rate-arbitrage', url: 'https://github.com/ksmit323/funding-rate-arbitrage' },
    ],
  },
  {
    id: 'delta-neutral-7030',
    name: 'Delta-Neutral 70/30 Spot–Perp',
    icon: '🔒',
    category: 'delta-neutral',
    shortDesc: 'Allocazione 70% spot + 30% perp short, auto-rebalance per mantenere delta=0 e farmare funding.',
    longDesc: `Variante della funding arb implementata da HL-Delta (open source). Mantiene una sproporzione 70/30 invece di 50/50 per ottimizzare capital efficiency: lo spot non richiede margine, mentre il perp ne richiede ~20%. Il bot rebalances quando il delta si scosta oltre soglia, e seleziona automaticamente i pair con funding più alto.`,
    expectedReturn: '8–20% APY (storico)',
    complexity: 'high',
    edgeType: 'structural',
    capital: 'medium',
    pros: [
      'Capital efficiency superiore al 50/50',
      'Open source con codice referenziabile',
      'Auto-rotation tra pair con miglior funding',
    ],
    cons: [
      'Rebalance frequente genera fees',
      'Drift del delta in periodi di volatilità estrema',
      'Liquidation possible sul leg perp se gap improvviso',
    ],
    bestFor: 'Operatori che vogliono yield passive automatizzato',
    sources: [
      { label: 'GitHub: cgaspart/HL-Delta', url: 'https://github.com/cgaspart/HL-Delta' },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // MARKET MAKING
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'maker-rebate-scalping',
    name: 'Maker Rebate Scalping',
    icon: '💎',
    category: 'market-making',
    shortDesc: 'Solo ordini limit GTC al bid/ask per incassare il rebate maker (-0.015% su HL).',
    longDesc: `Hyperliquid premia i maker con rebate -0.015% (paga il maker invece di farsi pagare). La strategia consiste nel piazzare ordini limit a bid/ask, attendere il fill, immediatamente piazzare l'ordine opposto. Profitto = rebate × 2 (round-trip) anche se il prezzo non si muove. Su 1M USD volume mensile = 300 USD di rebate puro. Richiede latency bassa e algoritmi di inventory management per non accumulare posizioni direzionali.`,
    expectedReturn: '0.3–1% / month (volume-dependent)',
    complexity: 'extreme',
    edgeType: 'speed',
    capital: 'large',
    pros: [
      'Edge strutturale dalla fee structure HL',
      'Scala con volume, non con price action',
      'Compatibile con HL Builder Codes per fee rebate aggiuntivo',
    ],
    cons: [
      'Inventory risk (accumulo di posizioni unbalanced)',
      'Adverse selection (informed traders ti fillano sui mossi)',
      'Richiede WebSocket order book streaming low-latency',
      'Capitale grosso necessario per generare volume',
    ],
    bestFor: 'Quant con esperienza MM e infra co-located',
    recommendedTF: 'tick-level',
    sources: [
      { label: 'GitHub: Novus-Tech HL-Market-Maker (Rust)', url: 'https://github.com/Novus-Tech-LLC/Hyperliquid-Market-Maker' },
      { label: 'Hyperliquid Builder Codes & Fees', url: 'https://hyperliquid.gitbook.io/hyperliquid-docs' },
    ],
  },
  {
    id: 'grid-bot-ranging',
    name: 'Grid Bot in Ranging Markets',
    icon: '🔲',
    category: 'market-making',
    shortDesc: 'Griglia di ordini buy/sell equispaziati. HL passa ~60% del tempo in ranging.',
    longDesc: `La strategia bot più popolare su HL. Si definisce un range (es. BTC 75k–85k) e si piazzano N ordini buy equispaziati sotto il prezzo e N sell sopra. Ogni fill apre automaticamente l'ordine opposto al livello successivo. Profitto = spread × numero di fill. Funziona splendidamente nei periodi di consolidamento (e HL/crypto consolida ~60% del tempo). Il rischio è il "trend break": se il prezzo esce sopra o sotto il range, ti ritrovi con una posizione direzionale grossa fuori dal grid. SrDebiasi/hyperliquid-grid-bot permette di mettere il capitale unused in yield strategies (lending) durante le ore senza fill.`,
    expectedReturn: '5–15% / month in ranging, blow-up in trend forte',
    expectedWR: '70–85% (per-fill, ma il "tail" può cancellare tutto)',
    complexity: 'medium',
    edgeType: 'statistical',
    capital: 'medium',
    pros: [
      'Funziona benissimo in mercati laterali (60% del tempo)',
      'Setup intuitivo e visibile sul chart',
      'Capital unused può fare yield in parallelo',
    ],
    cons: [
      'Trend forti distruggono il grid (devi avere stop-out level)',
      'Choice del range = stima soggettiva',
      'Tail risk asimmetrico: tanti piccoli win + 1 mega loss',
    ],
    bestFor: 'Asset in consolidamento storico (es. BTC tra ATH e support)',
    recommendedTF: 'tick + 15m per range definition',
    sources: [
      { label: 'GitHub: SrDebiasi/hyperliquid-grid-bot', url: 'https://github.com/SrDebiasi/hyperliquid-grid-bot' },
      { label: 'OctoBot Hyperliquid grid integration', url: 'https://www.octobot.cloud/hyperliquid-trading-bot' },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // STATISTICAL EDGE
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'mean-reversion-shorttf',
    name: 'Mean Reversion (RSI + BB short-TF)',
    icon: '🪃',
    category: 'mean-reversion',
    shortDesc: 'RSI oversold (<25) + touch BB lower → long contrarian. 70–80% reversal rate riportato.',
    longDesc: `Strategia di tipo "lean against the wind": individui condizioni di estremo statistico (RSI <25 oppure >75, prezzo che tocca le BB extreme) e entri contrarian con TP corti (1.5–2 ATR). Funziona benissimo in regime ranging, fallisce sul trend forte. Un trader Reddit segnalato come "best-performing" usa proprio questa logica: 60% mesi profittevoli con bet piccoli. Più affidabile su 5m–15m che su 1h+, perché su TF lunghi i trend "vincono".`,
    expectedReturn: '2–8% / month',
    expectedWR: '60–75% (in ranging)',
    complexity: 'medium',
    edgeType: 'statistical',
    capital: 'small',
    pros: [
      'Win rate alto rende facile il position sizing',
      'Setup chiaro e replicabile',
      'Pochi trade al giorno → fee impact contenuto',
    ],
    cons: [
      'Fallisce in trend forte (i mean revert non revertono)',
      'Richiede filtro di regime (ADX) per evitare i blow-up',
      'TP corti → margine sottile dopo fee',
    ],
    bestFor: 'Mercati in range definiti, dopo eventi/spike',
    recommendedTF: '5m / 15m',
    sources: [
      { label: 'GoodCrypto: Best HL strategies', url: 'https://goodcrypto.app/best-hyperliquid-trading-strategies-on-goodcryptox/' },
      { label: 'Databird: My first HL bot journey', url: 'https://www.databirdjournal.com/posts/building-your-first-trading-bot-on-hyperliquid-my-journey-from-crypto-curious-to-automated-trading' },
    ],
  },
  {
    id: 'passivbot-recursive',
    name: 'Passivbot Recursive Grid + Trailing',
    icon: '🤖',
    category: 'mean-reversion',
    shortDesc: 'Grid auto-adattivo con trailing entry e re-entry condizionali. Top tier open-source.',
    longDesc: `Passivbot è il bot open-source più maturo per perp DEX, recentemente con supporto Hyperliquid. Implementa griglie ricorsive: entra a una soglia, e ogni re-entry successivo è progressivamente più aggressivo, ma con trailing che aspetta una retracement reale prima di triggerare. La gestione del rischio è basata su "wallet exposure" massima per simbolo. Esiste una community attiva, parametri tunati pubblicamente, e backtest condivisi.`,
    expectedReturn: '5–20% / year (conservative tunings)',
    complexity: 'high',
    edgeType: 'statistical',
    capital: 'small',
    pros: [
      'Open source, community attiva, parametri condivisi',
      'Supporta multiple exchange (HL, Binance, Bybit, ecc.)',
      'Gestione rigorosa wallet exposure',
    ],
    cons: [
      'Parametri perfetti richiedono backtest accurato per asset',
      'Re-entry profondi possono accumulare DD del 30–50%',
      'Configurazione iniziale richiede ore di studio',
    ],
    bestFor: 'Quant patiente con rilancio incrementale del capitale',
    recommendedTF: '5m–1h adattivo',
    sources: [
      { label: 'GitHub: enarjord/passivbot', url: 'https://github.com/enarjord/passivbot' },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // DIRECTIONAL
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'trend-following-multitf',
    name: 'Trend Following 3–10x leverage (multi-TF)',
    icon: '🌊',
    category: 'directional',
    shortDesc: 'EMA cross o breakout 4h confirmato da 1h, leverage 3–10x con SL disciplinato.',
    longDesc: `La strategia "ovvia" che però richiede disciplina ferrea: identifichi un trend forte su 4h (es. EMA21 > EMA50, ADX > 30), entri a mercato sul pullback 1h, SL sotto lo swing low precedente, TP a 2–3R. Funziona perché i trend crypto possono durare giorni o settimane: pochi trade vincenti molto grossi compensano molti piccoli perdenti. Su Hyperliquid il leverage 3–10x è sostenibile su BTC/ETH (volatilità "controllata"); su SOL/altcoin meglio ≤5x.`,
    expectedReturn: '20–80% / year in trending years, -20% in choppy years',
    expectedWR: '35–45% (R:R 2.5+ compensa)',
    complexity: 'low',
    edgeType: 'discretionary',
    capital: 'small',
    pros: [
      'Setup semplice e replicabile',
      'TF alto = poco rumore, fee impact basso',
      'Trend lunghi compensano molti SL piccoli',
    ],
    cons: [
      'Lunghi periodi in chop = death by 1000 cuts',
      'Psicologicamente difficile (molti piccoli loss consecutivi)',
      'Drawdown grossi in periodi di consolidamento',
    ],
    bestFor: 'Operatori macro pazienti, periodi di bull/bear market chiari',
    recommendedTF: '1h trigger + 4h regime',
    sources: [
      { label: 'BraveNewCoin: Top 7 HL bots 2026', url: 'https://bravenewcoin.com/sponsored/article/top-7-hyperliquid-trading-bots-for-2026' },
      { label: 'MEXC News: HL strategies & bot setup', url: 'https://www.mexc.com/news/1034578' },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // SPECIALTY
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'liquidation-hunting',
    name: 'Liquidation Cluster Hunting',
    icon: '🎯',
    category: 'specialty',
    shortDesc: 'Long stops cluster sotto i supporti, dove le large hands vanno a "raccogliere".',
    longDesc: `Strategia avanzata: analizzando l'open interest distribution e i livelli di leverage medio, si stimano i cluster di stop-loss e liquidation. I market maker e i large traders spesso pushano il prezzo a toccare questi cluster per attivare le liquidazioni e poi rientrano contro-direzione. La strategia entra LONG quando il prezzo tocca un cluster di stop-loss long e mostra reversal pattern. Su Hyperliquid esistono dashboard che visualizzano la liquidation map (CoinGlass, Hyperdash).`,
    expectedReturn: 'High variance, 40–60% di trade vincenti',
    expectedWR: '55–65%',
    complexity: 'high',
    edgeType: 'structural',
    capital: 'small',
    pros: [
      'Edge basato su flussi reali, non TA tradizionale',
      'Setup chiari (cluster visibili)',
      'Reward asimmetrico (TP grossi)',
    ],
    cons: [
      'Richiede data feed liquidation in real-time',
      'False positive frequenti in low-volume',
      'Tempistica critica (entrata troppo presto = sl)',
    ],
    bestFor: 'Discretionary trader con buona lettura dell\'order flow',
    recommendedTF: '5m–15m',
    sources: [
      { label: 'Hyperdash Liquidation Map', url: 'https://hyperdash.info/' },
      { label: 'CoinGlass Liquidation Heatmap', url: 'https://www.coinglass.com/LiquidationMap' },
    ],
  },
  {
    id: 'cross-exchange-spread',
    name: 'Cross-Exchange Spread (HL vs Binance/OKX)',
    icon: '🔀',
    category: 'arbitrage',
    shortDesc: 'Sfrutta spread tra perp HL e perp Binance/OKX quando divergono >0.1%.',
    longDesc: `Hyperliquid e gli exchange centralizzati (Binance, OKX) trattano gli stessi perp, ma con price discovery indipendente. Quando si crea uno spread temporaneo (>0.1%), apri long sull'exchange dove il prezzo è più basso e short su quello più alto. Quando lo spread si chiude, chiudi entrambi. Richiede capitale su entrambi i venue, latency bassa, e gestione separata del margine.`,
    expectedReturn: '5–15% APY con buon throughput',
    complexity: 'extreme',
    edgeType: 'speed',
    capital: 'large',
    pros: [
      'Delta-neutral (nessuna direzionalità)',
      'Profit quasi sicuro quando spread si chiude',
      'Edge persistente finché HL e CEX restano separati',
    ],
    cons: [
      'Doppio inventory e doppi fee',
      'Rebalance del USDC/USDT tra venue (withdrawal)',
      'Funding cost se la posizione resta aperta troppo',
      'Richiede infra co-located in più datacenter',
    ],
    bestFor: 'Quant trader professionali con multi-venue setup',
    recommendedTF: 'sub-second',
    sources: [
      { label: 'Pink Brains: Tested 11 perp DEXs', url: 'https://pinkbrains.io/blogs/i-tested-11-perp-dexs-so-you-dont-have-to' },
    ],
  },
  {
    id: 'hyperps-mean-reversion',
    name: 'Hyperps (HL native pre-launch perps)',
    icon: '⚗️',
    category: 'specialty',
    shortDesc: 'Sui contratti "Hyperps" (pre-launch HL), il funding è notoriamente squilibrato → arb opportunity.',
    longDesc: `Hyperps sono perp contracts su token che non hanno ancora il loro mainnet/spot live. Il prezzo deriva da TWAP + funding rate dinamico molto aggressivo. Storicamente questi contratti hanno funding rate che si squilibra molto (>1%/h non è raro), creando opportunità di funding arb molto più redditizie del normale. Rischio elevato: liquidità bassa, volatilità estrema, e il "perp" può scendere a zero al lancio del token se la TGE delude.`,
    expectedReturn: '20–100%+ APY su periodi corti',
    complexity: 'extreme',
    edgeType: 'structural',
    capital: 'micro',
    pros: [
      'Funding rate spesso estremo = profitto rapido',
      'Nessuna concorrenza grande (illiquid)',
      'Setup interessante per "first mover"',
    ],
    cons: [
      'Illiquid → slippage alto',
      'Convergenza al fair value imprevedibile',
      'Token può crollare o spike improvvisi',
      'Documentazione e backtest scarsi',
    ],
    bestFor: 'Trader esperti con tolleranza al rischio alta',
    sources: [
      { label: 'Hyperliquid Docs: Hyperps', url: 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/hyperps' },
    ],
  },
  {
    id: 'event-driven-news',
    name: 'Event-Driven (CPI / FOMC / Token Listings)',
    icon: '📰',
    category: 'directional',
    shortDesc: 'Trade i 5–15 minuti dopo eventi macro o listing per cavalcare il momentum iniziale.',
    longDesc: `Sui rilasci macro (CPI USA 14:30 UTC, FOMC, NFP) o sui listing di nuovi token su HL, il prezzo reagisce con momentum chiaro nei primi 5–15 minuti, poi consolida. La strategia entra in direzione del primo movimento (con conferma su 1m o 3m volume spike) e chiude entro 30 minuti. Richiede calendar integration e reazione veloce — perfetto per automazione.`,
    expectedReturn: '10–30% / month in periodi di alta news',
    expectedWR: '55–70%',
    complexity: 'high',
    edgeType: 'structural',
    capital: 'small',
    pros: [
      'Edge temporale chiaro (windows di high vol)',
      'Setup automatizzabile con economic calendar',
      'Pochi trade ma di alta qualità',
    ],
    cons: [
      'Eventi rari (4–6 high-impact al mese)',
      'Slippage alto nei primi secondi post-news',
      'False signal su revisioni o dati ambigui',
    ],
    bestFor: 'Bot con news feed integrato (Investing.com, ForexFactory)',
    recommendedTF: '1m–5m post-event',
    sources: [
      { label: 'OctoBot HL automation', url: 'https://www.octobot.cloud/hyperliquid-trading-bot' },
    ],
  },
]
