# CLAUDE.md: kontext projektu pro pokračování

Interaktivní výuková simulace tříčlenného novokeynesiánského modelu (Woodford, *Interest and Prices*; Hall & Woodford, Nobel 2026). Hlavní účel je, aby autor model do hloubky pochopil: jak spolu souvisí poptávka, inflace, sazby a očekávání. Vedlejší účel je hra „Buď ČNB“.

- Repozitář: https://github.com/hlavacmarian/EkonomistProject (veřejný), větev `main`. Lokální kopie je v `C:\Users\Marian\Desktop\nk-lab`.
- **Stav: fáze 1 (laboratoř šoků) je hotová**, commit `e720f94`. Další na řadě je **fáze 2**.
- Postup je dohodnutý ve 4 fázích. **Po každé fázi se zastav, shrň, co je hotové a jak jsi to ověřil, a počkej na pokyn.**
- S uživatelem komunikuj česky. Kód a komentáře piš anglicky.
- Commit nebo push dělej jen na požádání. Commity končí řádkem `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Spuštění a technologie

```bash
npm start   # statický server bez závislostí, http://localhost:5173/ (PORT=… mění port)
npm test    # node --test, aktuálně 41 testů, všechny procházejí
```

- Čisté ES moduly, žádný build a **žádné závislosti**, Node ≥ 18. Tak to drž. Pokud bude nějaká knihovna opravdu nutná (např. WebGL ve fázi 4), načítej ji z CDN s přesnou verzí, ale nejdřív zvaž canvas 2D.
- Aplikace se nasazuje jako statický web (`index.html`, `src/`, `locales/`). Musí se servírovat přes HTTP, protože překlady se načítají přes `fetch`.
- Pro náhled v desktopové aplikaci si vytvoř `.claude/launch.json` (je v `.gitignore`):
  `{"version":"0.0.1","configurations":[{"name":"nk-lab","runtimeExecutable":"node","runtimeArgs":["scripts/serve.mjs"],"port":5173}]}`

## Obecné požadavky (platí pro všechny fáze)

- Běží v prohlížeči na desktopu i mobilu (16px okraj, žádný vodorovný posuvník).
- **Jádro modelu je čistý modul bez DOM**, pokrytý unit testy. UI jen napojuje stav, ovládání, grafy a texty.
- CZ/EN s přepínačem, texty v `locales/cs.json` a `locales/en.json`, výchozí čeština. Test `test/i18n.test.js` hlídá, že oba soubory mají stejné klíče a stejné počty odstavců. Každý nový text tedy přidej do obou.
- Důraz na vysvětlení: každý parametr má tooltip „co to znamená ekonomicky“ a každý scénář panel „co se děje a proč“ s odkazem na konkrétní rovnici. Odkazy se v textech píšou jako `[[IS]]`, `[[NKPC]]`, `[[TR]]` a `[[E]]`. UI z nich udělá tlačítko, které rovnici zvýrazní.
- V aplikaci je viditelné upozornění, že jde o výukový model s učebnicovou kalibrací, ne o předpověď.
- README popisuje spuštění, model, rovnice a řešicí metody. Po každé fázi ho aktualizuj.

## Struktura kódu

```
src/model/            jádro modelu (bez DOM)
  params.js           DEFAULT_PARAMS, PARAM_META (rozsahy posuvníků), lowerBoundDev, toLevels
  shocks.js           shockPaths(shocks, T), shockEnd, isAr1Only
  policy.js           policyOverrides: delay (sazba na neutrálu pro t < L), holdUntil (na mezi pro t < q)
  determinacy.js      taylorPrincipleValue, transitionMatrix, determinacy (vlastní čísla)
  rational.js         solveRational: neurčité koeficienty (MUC), nebo dokonalé předvídání (PF) + guess-and-verify na mezi
  hybrid.js           solveHybrid: krokování vpřed, endogenní ukotvení (nextAnchoring)
  check.js            residuals(sol, p): IS, NKPC, pravidlo/komplementarita, konzistence očekávání, mez
  index.js            simulate(spec, mode) = veřejné API
src/scenarios.js      SCENARIOS (custom, oil, pandemic, zlb, deanchor), buildRuns(built, mode)
src/ui/app.js         stav, ovládání, vykreslení, připínání, vysvětlení, tabulka čísel
src/ui/chart.js       vlastní SVG čárový graf: createChart(el,{title,unit,onHover}) → update/setCursor/setTitle
src/ui/i18n.js        loadLocale, t(key, vars), fmt(v, digits) (desetinná čárka v cs), applyStatic
src/ui/styles.css     barvy jako CSS proměnné (světlý i tmavý motiv), --s1 racionální, --s2 hybridní, --s3/5/6/7 připnuté
test/                 model.test.js, i18n.test.js
```

### Model a konvence jednotek

```
(IS)   x_t  = m·E_t x_{t+1} − σ (i_t − E_t π_{t+1} − rn_t)
(NKPC) π_t  = β·m·E_t π_{t+1} + κ x_t + u_t
(TR)   i_t  = max(lb, φπ π_t + φx x_t + v_t)
(E)    hybridní: E_t π_{t+1} = w_t·0 + (1 − w_t) π_{t−1},  E_t x_{t+1} = x_{t−1}
```

- **Jednotky:** čtvrtletní odchylky od ustáleného stavu v %. Mezera x je v % potenciálu. UI zobrazuje anualizované úrovně: π = 4π + π\*, i = 4i + r\* + π\*, reálná = 4r + r\*, přirozená = 4rn + r\*. Velikost šoku se zadává v p. b. p.a. a dělí se 4.
- **Kalibrace:** β = 0,99, σ = 1, κ = 0,1, φπ = 1,5, φx = 0,125, ρ = 0,8, π\* = 2 %, r\* = 1 %, dolní mez = 0 %. r\* je jen zobrazovací parametr (formálně β = 0,99 implikuje zhruba 4 %), v README je to uvedené.
- **m** je kognitivní diskontování (Gabaix 2020). Platí jen v racionálním režimu. Výchozí hodnota 1.
- **Spec běhu:** `simulate({ params, shocks: [{kind:'rn'|'u'|'v', size, rho, shape:'ar1'|'step', duration, start}], policy: {delay, holdUntil}, horizon, forwardGuidance }, 'rational'|'hybrid')`.
  - `forwardGuidance: N` znamená `holdUntil = konec schodu + N`. Funguje jen pro šok typu schod.
- **Výsledek** obsahuje `x, pi, i, r, Ex, Epi, rn, u, v, shadow, atBound, forced` (u hybridního režimu i `w`), dále `levels`, `residual`, `method` ('muc' | 'pf' | 'forward'), `converged` a u hybridního `stable`.
  - Při neurčitosti vrátí `{determinate:false, determinacy}` bez cest.
  - Reálná sazba v hybridním režimu používá subjektivní E_tπ_{t+1}.
- **Výběr metody:** racionální režim použije MUC, jen když jsou všechny šoky AR(1) od t = 0, nic není vynucené a mez neváže. Jinak použije PF: soustava 3T×3T, T = max(60, horizont + 40), terminální podmínka x_T = π_T = 0, Gaussova eliminace.
- **Determinace:** obě vlastní čísla A mimo jednotkový kruh. Pro m = 1 to odpovídá podmínce κ(φπ − 1) + (1 − β)φx > 0, což test ověřuje. Při neurčitosti UI nekreslí **žádnou** racionální cestu (ani srovnávací) a zobrazí vysvětlení.
- **Endogenní ukotvení:** s_t = (1−λ)s_{t−1} + λ|4π_t| a w_{t+1} = w̄·exp(−max(0, s_t − pásmo)/pásmo). Výchozí w̄ = 0,6 (ve scénáři 4 je 0,8), pásmo 1 p. b., λ = 0,3.
- **Scénáře:** `build(params, settings)` vrací `{main, alt?}`. Alternativní běh se kreslí čárkovaně. Výběr scénáře vrátí parametry na výchozí hodnoty, připnuté běhy zůstanou.
  - Scénář 3: schod −5 p. b. na 6 čtvrtletí, výchozí N = 1.
  - Scénář 4: u = 2,5 p. b., ρ = 0,85, zpoždění 4 čtvrtletí, hybridní režim.

## Fáze 2: zadání (doslova od uživatele)

Živý diagram:
- Uzly: Očekávání nahoře; Poptávka, Inflace, Centrální banka pod ním; šipky podle kauzálního řetězce včetně zpětné vazby sazby do poptávky.
- Tloušťka a pulzování šipek podle velikosti příspěvku v daném čtvrtletí; časová osa synchronizovaná s grafy (přehrát, krokovat, posouvat).
- Rozklad každé proměnné na příspěvky členů rovnice (např. inflace = očekávání + mezera + šok) jako skládaný sloupcový graf.

Hra Buď ČNB:
- Každé čtvrtletí nastavím nominální sazbu (krok 0,25 p. b.). Délka nastavitelná, výchozí 24 čtvrtletí.
- Náhodné šoky s volitelnou obtížností (rozptyl šoků), seedovaný generátor kvůli opakovatelnosti.
- Data vidím se zpožděním jednoho čtvrtletí a se šumem; mezera výstupu je zašuměná víc než inflace.
- Očekávání v hybridním režimu s endogenním ukotvením: věrohodnost roste, když držím inflaci u cíle, a klesá, když ji nechám ujet. (Racionální očekávání vyžadují známé pravidlo, které hráč nemá.)
- Během hry žádné průběžné skóre.
- Vyhodnocení po hře: ztrátová funkce (odchylka inflace od cíle na druhou + vážená mezera na druhou + penalizace za skoky sazby), srovnání s autopilotem podle Taylorova pravidla při stejné sekvenci šoků, grafy přes sebe a slovní rozbor největších chyb (pozdní reakce, přehnaná reakce, reakce na šum, uvolnění při nabídkovém šoku). Rozbor generuj pravidly, ne přes LLM.

### Návrhy k fázi 2 (z kontextu fáze 1, nejsou závazné)

- **Rozklad na příspěvky** jde spočítat přímo z polí výsledku, žádný nový řešič není potřeba:
  - IS: x = m·Ex (očekávání) − σ(i − Epi) (reálná sazba) + σ·rn (přirozená sazba);
  - NKPC: π = β·m·Epi (očekávání) + κx (mezera) + u (šok);
  - TR: i = φπ·π + φx·x + v, plus vliv meze, tj. i − shadow, když `atBound`.
  - Zajisti testem, že součet příspěvků = proměnná s chybou < 1e-9.
  - Šipky diagramu: očekávání → poptávka/inflace, poptávka → inflace (κx), inflace/poptávka → banka, banka → poptávka (reálná sazba). Příspěvky do čísel přepočítávej stejně jako v grafech (anualizace, kde dává smysl).
- **Časová osa:** grafy už mají sdílený kurzor (`state.cursor` a `setCursor` na všech grafech). Přehrávání a posuvník napoj na totéž.
- **Hra potřebuje krokové API.** `solveHybrid` dnes bere celou politiku dopředu. Rozděl ho na čistou funkci jednoho kroku (`stepHybrid(state, shock_t, rate_t | null) → {state', x, π, i, …}`) a `solveHybrid` přepiš tak, aby ji volal. Stávající testy musí dál procházet.
  - Herní logiku (generátor šoků se seedem, pozorování se zpožděním a šumem, ztrátu, autopilota, pravidlový rozbor chyb) dej do `src/game/` nebo `src/model/game.js`, bez DOM a s testy: opakovatelnost se stejným seedem, autopilot = solveHybrid se stejnými šoky, ztráta, pravidla rozboru na připravených případech.
- **Sazba hráče je v úrovni % p.a.** Do modelových jednotek se převádí (i_lvl − r\* − π\*)/4 a nesmí klesnout pod dolní mez.

## Fáze 3 a 4 (pro orientaci, doslova)

**Fáze 3: malá otevřená ekonomika**
- Rozšíření o kurz koruny (zjednodušený model malé otevřené ekonomiky typu Galí-Monacelli): nekrytá úroková parita, dovážená inflace v CPI, zahraniční šoky (zahraniční sazba, zahraniční poptávka, šok kurzu).
- Uzavřený model zůstává beze změny jako samostatný režim; přepínač uzavřená/otevřená.
- Diagram i hra fungují i v otevřeném režimu (kurz jako další uzel).
- Volitelný scénář inspirovaný kurzovým závazkem ČNB (2013 až 2017): sazby na mezi, uvolnění přes kurz.

**Fáze 4: agentní simulace**
- Stovky až nízké tisíce domácností a desítky firem vykreslené jako body (canvas nebo WebGL kvůli výkonu).
- Domácnosti: nastavitelný podíl (výchozí 20 %) žije od výplaty k výplatě a utrácí aktuální příjem; ostatní vyhlazují spotřebu podle očekávaného příjmu a reálné sazby.
- Firmy: v každém čtvrtletí smí cenu změnit jen část z nich (Calvo) a nastavují ji s ohledem na očekávané náklady a poptávku.
- Centrální banka: Taylorovo pravidlo nebo hráč.
- Agregáty ve stejných grafech jako ve fázi 1 a porovnání s tříčlenným modelem při odpovídající kalibraci. Shodu ber kvalitativně a v UI to tak popiš.
- Vizualizace: barva domácností podle utrácení vs. spoření, záblesk u firmy, která mění cenu.

## Ověřování (jak se to dělalo ve fázi 1)

- `npm test` musí procházet. Nové části jádra pokryj testy: rezidua < 1e-9, znaménka, mez, ustálený stav bez šoků, determinace.
- V prohlížeči ověř desktop i mobil (375 px, bez vodorovného posuvníku), CZ i EN a konzoli bez chyb.
- **Neověřeno z fáze 1:** světlý motiv vizuálně, Safari a skutečný telefon.
- Chybí soubor LICENSE. Přidej ho jen na požádání.
