# CLAUDE.md: kontext projektu pro pokračování

Interaktivní výuková simulace tříčlenného novokeynesiánského modelu (Woodford, *Interest and Prices*; Hall & Woodford, Nobel 2026). Hlavní účel je, aby autor model do hloubky pochopil: jak spolu souvisí poptávka, inflace, sazby a očekávání. Vedlejší účel je hra „Buď ČNB“.

- Repozitář: https://github.com/hlavacmarian/EkonomistProject (veřejný), větev `main`. Lokální kopie je v `C:\Users\Marian\Desktop\nk-lab`.
- **Stav: fáze 1 (laboratoř šoků), 2 (živý diagram + hra Buď ČNB) a 3 (malá otevřená ekonomika) jsou hotové.** Fáze 2 a 3 jsou na větvi `claude/funny-sagan-giyc11` (zatím nesloučené do `main`). Další na řadě je **fáze 4** (rozhodnutí uživatele k ní jsou níže).
- Postup je dohodnutý ve 4 fázích. **Po každé fázi se zastav, shrň, co je hotové a jak jsi to ověřil, a počkej na pokyn.**
- S uživatelem komunikuj česky. Kód a komentáře piš anglicky.
- Commit nebo push dělej jen na požádání. Commity končí řádkem `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Spuštění a technologie

```bash
npm start   # statický server bez závislostí, http://localhost:5173/ (PORT=… mění port)
npm test    # node --test, aktuálně 145 testů, všechny procházejí
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
  hybrid.js           stepHybrid(p, state, shock, rate|null) → {x, π, i, …, state'}; solveHybrid = smyčka přes něj;
                      initialHybridState, nextAnchoring(p, memory, w)
  check.js            residuals(sol, p): IS, NKPC, pravidlo/komplementarita, konzistence očekávání, mez
  open.js             malá otevřená ekonomika: solveOpenRational (PF, pásová eliminace, guess-and-verify přes mez
                      i hranici kurzu), stepOpen / solveOpenHybrid, openDeterminacy (5×5), openResiduals, fxLevel
  linalg.js           solveLinear (hustá), solveBanded (pásová), charPoly + polyRoots → eigenvalues
  decompose.js        decompose / decomposeDisplay (příspěvky členů rovnic, i otevřená: bloky IS, NKPC=CPI, UIP, TR),
                      causalFlows (šipky diagramu), TERMS / OPEN_TERMS, FLOW_TARGET / OPEN_FLOW_TARGET
  index.js            simulate(spec, mode) = veřejné API; spec.economy = 'closed' | 'open'; toOpenLevels
src/game/             hra bez DOM: rng.js (mulberry32, gaussian), game.js (createGame, observe, submitRate,
                      isOver, drawGame, FIRE, FOREIGN_PROCESS), evaluate.js (lossBreakdown, autopilotSolution,
                      dataRuleSolution, analyze, evaluateGame, RULES, LOSS_WEIGHTS), economy.js (gameModel: krok /
                      start / cesta pro uzavřenou i otevřenou ekonomiku), index.js
src/scenarios.js      SCENARIOS (custom, oil, pandemic, zlb, deanchor, koruna), buildRuns(built, mode)
src/ui/app.js         záložky (#lab / #game), stav, ovládání, časová osa, živý panel, připínání, vysvětlení
src/ui/chart.js       SVG čárový graf: createChart(el,{title,unit,onHover}) → update/setCursor/setTitle;
                      data umí points (body), hbands (pásmo), bands [a,b,třída], xLabel/tickFrom
src/ui/bars.js        skládaný sloupcový graf příspěvků (stejné API jako chart.js)
src/ui/diagram.js     živý kauzální diagram (SVG, kompaktní rozložení pod 540 px)
src/ui/live.js        panel: diagram + rozklad v číslech + 3 sloupcové grafy; update({result, params, runs, context})
src/ui/timeline.js    přehrát/krokovat/posuvník; createTimeline(el,{onChange,label,texts})
src/ui/game.js        obrazovky hry: nastavení, tah, vyhodnocení (grafy, rozbor, živý diagram)
src/ui/i18n.js        loadLocale, t(key, vars), fmt(v, digits) (desetinná čárka v cs), eqRefs, applyStatic
src/ui/styles.css     barvy jako CSS proměnné (světlý i tmavý motiv), --s1 racionální/hráč, --s2 hybridní,
                      --up/--down šipky, --c-* členy rozkladu
test/                 model.test.js, decompose.test.js, open.test.js, game.test.js, i18n.test.js
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
- **Spec běhu:** `simulate({ params, shocks: [{kind:'rn'|'u'|'v', size, rho, shape:'ar1'|'step', duration, start}], policy: {delay, holdUntil, rates}, horizon, forwardGuidance }, 'rational'|'hybrid')`.
  - `shocks` může být i objekt hotových cest `{rn, u, v}` v modelových jednotkách (hra); `policy.rates[t]` = vynucená sazba v modelových jednotkách (NaN/null = pravidlo), nikdy pod mezí.
  - `forwardGuidance: N` znamená `holdUntil = konec schodu + N`. Funguje jen pro šok typu schod.
- **Výsledek** obsahuje `x, pi, i, r, Ex, Epi, rn, u, v, shadow, atBound, forced` (u hybridního režimu i `w`), dále `levels`, `residual`, `method` ('muc' | 'pf' | 'forward'), `converged` a u hybridního `stable`.
  - Při neurčitosti vrátí `{determinate:false, determinacy}` bez cest.
  - Reálná sazba v hybridním režimu používá subjektivní E_tπ_{t+1}.
- **Výběr metody:** racionální režim použije MUC, jen když jsou všechny šoky AR(1) od t = 0, nic není vynucené a mez neváže. Jinak použije PF: soustava 3T×3T, T = max(60, horizont + 40), terminální podmínka x_T = π_T = 0, Gaussova eliminace.
- **Determinace:** obě vlastní čísla A mimo jednotkový kruh. Pro m = 1 to odpovídá podmínce κ(φπ − 1) + (1 − β)φx > 0, což test ověřuje. Při neurčitosti UI nekreslí **žádnou** racionální cestu (ani srovnávací) a zobrazí vysvětlení.
- **Endogenní ukotvení:** s_t = (1−λ)s_{t−1} + λ|4π_t|, w\*_t = w̄·exp(−max(0, s_t − pásmo)/pásmo), w_{t+1} = w_t + g(w\*_t − w_t). Výchozí w̄ = 0,6 (ve scénáři 4 je 0,8), pásmo 1 p. b., λ = 0,3, g = `anchorSpeed` = 1 (laboratoř beze změny proti fázi 1), start `anchorInit` = null (= w̄). Hra: w̄ = 0,9, start 0,6, g = 0,3.
- **Otevřená ekonomika** (`open.js`, rovnice v README): x = c + δq + γy*, Eulerova rovnice pro c s reálnou sazbou i − Eπᴴ, NKPC pro domácí inflaci πᴴ, CPI = (1−α)πᴴ + απᶠ s postupným přenosem kurzu (ψ, mezera d), reálná UIP q = Eq − (i − Eπᴴ − i*) + χ + ξ, nominální kurz e = q + pᴴ, pravidlo na (1−ω)π + ωπᴴ. Kalibrace α 0,35, δ 0,1, γ 0,5, ψ 0,2, θ 0,8 (hybridní E q' = θq), ω 0, výchozí kurz 25,7 CZK/EUR (jen zobrazení). Šoky istar, ystar (v %, nedělí se 4), chi. Kurzový závazek `policy.fxFloor = {level (% nad ustáleným stavem), from, to}`, intervence ξ ≥ 0 jen na hranici. Racionální = vždy PF, T = max(130, h + 90). Determinace: 3 nestabilní kořeny z 5, jeden kořen je strukturálně přesně 1 (trvalé oslabení vyrovnané nižší c), počítá se k nestabilním. Bez obchodu = přesně uzavřený model (test).
- **Proč ψ = 0,2 (ne 0,5):** s rychlým přenosem se pravidlo reagující se zpožděním na CPI rozkmitá (zisk smyčky sazba → kurz → CPI → sazba > 1). Ve hře pak pravidlo na datech končilo odvoláním v 90 % her.
- **Scénáře:** `build(params, settings)` vrací `{main, alt?}`. Alternativní běh se kreslí čárkovaně. Výběr scénáře vrátí parametry na výchozí hodnoty, připnuté běhy zůstanou.
  - Scénář 3: schod −5 p. b. na 6 čtvrtletí, výchozí N = 1.
  - Scénář 4: u = 2,5 p. b., ρ = 0,85, zpoždění 4 čtvrtletí, hybridní režim.
  - Scénář 5 (koruna, `fixedEconomy: 'open'`): rn −2 + y* −1,5 + i* −1, schody na 10 čtvrtletí, ω = 1, hranice 27 CZK/EUR od Q1 po dobu 12 čtvrtletí, racionální režim. Sazba se nevynucuje: držení na nule by v racionálním režimu spustilo hádanku forward guidance (CPI ~200 %). S ω = 0 pravidlo závazek samo podkope, to je v textu jako pokus.
  - Přepínač ekonomiky (`settings.economy`) přežije změnu scénáře, pokud scénář nevyžaduje jinou.

## Fáze 2: co je hotové a jak (pro navazování)

- **Rozklad** (`decompose.js`): IS = m·Ex + σ·Epi − σ·i + σ·rn; NKPC = β·m·Epi + κx + u; TR = φπ·π + φx·x + v + (max(lb, s) − s) [mez] + (i − max(lb, s)) [mimo pravidlo: zpoždění, slib, hráč]. Zobrazení: IS v % potenciálu, NKPC a TR ×4. Šipky diagramu (`causalFlows`) jsou skupiny těchto členů, šipky do uzlu se sečtou na jeho hodnotu (testováno).
- **Časová osa** je sdílená s grafy: `state.quarter`, najetí na graf ji posune (odjetí pozici nechá). V laboratoři je lepkavá nad grafy, ve vyhodnocení hry má vlastní instanci.
- **Hra:** 4 čtvrtletí historie (Taylor) + N tahů. Šoky AR(1) + vzácné události se zprávami, obtížnost ×0,6/1/1,35 (jen šoky, ne šum). Šum: inflace 0,3, mezera 0,9, očekávání 0,2. Pozorování jen za čtvrtletí < t. Odvolání (`FIRE`): |π − π\*| > 10 p. b. nebo |x| > 12 %, hra končí dřív a vyhodnotí se odehraná čtvrtletí (autopilot přes stejná čtvrtletí). Ztráta (π−π\*)² + 0,5x² + 0,25(Δi)². Srovnání: autopilot (Taylor modelu, skutečná aktuální data) a „pravidlo na tvých datech“ (zpožděná zašuměná data, zaokrouhleno). Rozbor: 4 pravidla s prahy v `RULES`, řazení podle ztráty navíc proti autopilotovi v okně 4 čtvrtletí, texty jsou šablony v locales. Výchozí seed 1998.
- **Kalibrace šoků hry** byla laděná simulací přes stovky seedů: při velkých poptávkových šocích hybridní model (E x = x_{t−1} je integrátor) na nulové mezi exploduje i s autopilotem (deflační past). Při zvětšování šoků to znovu ověř.
- **Ověřeno:** `npm test` (91), Playwright: desktop 1400 px i 375 px bez vodorovného posuvníku, CZ i EN, světlý i tmavý motiv, konzole bez chyb, celá hra myší i klávesnicí, odvolání, opakování se stejným seedem, záložky přes `#game`/`#lab`.
- **Neověřeno:** Safari a skutečný telefon (dotykové přejíždění po grafech).

## Fáze 2: původní zadání (doslova od uživatele)

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

## Fáze 3: co je hotové a jak (pro navazování)

- Laboratoř: přepínač Uzavřená/Otevřená, sekce „Otevřená ekonomika“ (α, δ, γ, ψ, θ, ω, kurz), šoky i*/y*/χ, grafy kurzu (stínování = koruna na hranici) a domácí vs. dovozní inflace, zahraniční sazba v grafu sazby, rovnice CPI a UIP (odkazy `[[CPI]]`, `[[UIP]]`), scénář 5.
- Diagram: `layout(W, open)`, uzel kurzu vpravo nahoře, čistý vývoz jako vedená šipka (`type: 'route'`) přes horní okraj, v úzkém otevřeném rozložení mají vstupy jen názvy. Živý panel má v otevřeném režimu 4 sloupcové grafy (IS, CPI, UIP, TR).
- Hra: `config.economy`. Zahraniční šoky jdou ze samostatného proudu RNG (`seed ^ 0x5bd1e995`), takže domácí šoky i uzavřené hry jsou bitově stejné jako ve fázi 2 (ověřeno). Kurz hráč vidí přesně a hned. Pravidla rozboru jsou stejná.
- Ověřeno: `npm test` (145), Playwright 1400 i 375 px bez vodorovného posuvníku, CZ i EN, světlý i tmavý motiv, konzole bez chyb, scénář 5, celá hra v otevřené ekonomice.

## Fáze 4: rozhodnutí uživatele (listopad 2026)

Uživatel chce, aby byla ekonomika **i graficky vidět**: tečky = subjekty (fyzické i právnické osoby), šipky mezi nimi = platby a tloušťka šipky = velikost transakce, aby bylo vidět, jak ekonomika funguje. Ke 3 otázkám odpověděl:
- **Pořadí:** nejdřív fáze 3 (hotovo), tečky a platby až ve fázi 4.
- **Mechanika:** **skuteční agenti**, kteří se sami rozhodují (domácnosti utrácejí podle příjmu a sazby, firmy mění ceny jen občas). Poptávka a inflace vzniknou zdola a s tříčlenným modelem se shodují jen kvalitativně. Nechce jen obrázek tříčlenného modelu.
- **Subjekty** (vedle domácností, firem a centrální banky): **komerční banka** (vklady, úvěry, úroky jako šipky), **stát** (daně, dávky), **zahraničí** (dovoz, vývoz, napojení na otevřenou ekonomiku) a **firmy mezi sebou** (dodavatelská síť).
- Platby jako šipky s tloušťkou podle částky jsou rozšíření původního zadání fáze 4 (to mělo jen barvy domácností a záblesky firem). Drž obojí.

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
- **Neověřeno:** Safari a skutečný telefon. Světlý i tmavý motiv jsou od fáze 2 ověřené na snímcích z Playwrightu.
- Chybí soubor LICENSE. Přidej ho jen na požádání.
