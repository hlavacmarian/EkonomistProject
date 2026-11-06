# Laboratoř novokeynesiánského modelu / NK Model Lab

Interaktivní výuková simulace tříčlenného novokeynesiánského modelu (Woodford, *Interest and Prices*, 2003), která ukazuje, jak spolu souvisí poptávka, inflace, sazby a očekávání.

> **Výukový model s učebnicovou kalibrací, ne předpověď.** Čísla ilustrují mechanismy a nepopisují českou ani jinou skutečnou ekonomiku.

Stav: **Fáze 1 (laboratoř šoků), fáze 2 (živý diagram a hra „Buď ČNB“) a fáze 3 (malá otevřená ekonomika s kurzem koruny).** Fáze 4 (agentní simulace) zatím chybí.

## Spuštění

Potřebujete Node.js 18 nebo novější. Nic se neinstaluje, projekt nemá žádné závislosti.

```bash
npm start
```

Pak otevřete <http://localhost:5173/> (jiný port: `PORT=8080 npm start`).

Testy jádra:

```bash
npm test
```

**Nasazení:** jde o čistě statický web (HTML + ES moduly + JSON), bez buildu. Na libovolný statický hosting (GitHub Pages, Netlify, S3…) stačí nahrát `index.html`, `src/` a `locales/`. Stránka se musí servírovat přes HTTP, protože překlady se načítají přes `fetch`. Ze souboru `file://` nefunguje.

## Struktura

```
index.html            stránka
src/model/            jádro modelu: čisté ES moduly bez DOM, pokryté testy
  params.js           kalibrace, metadata posuvníků, převod na anualizované úrovně
  shocks.js           cesty šoků (AR(1) a „schod“)
  policy.js           zpoždění reakce banky a forward guidance
  determinacy.js      Taylorův princip a test vlastních čísel
  rational.js         racionální očekávání: neurčité koeficienty + dokonalé předvídání s dolní mezí
  hybrid.js           hybridní/adaptivní očekávání: stepHybrid (jedno čtvrtletí) a solveHybrid (celá cesta), endogenní ukotvení
  check.js            rezidua (dosazení řešení zpět do rovnic)
  open.js             malá otevřená ekonomika: dokonalé předvídání (pásová eliminace), krokování, determinace, rezidua
  linalg.js           Gaussova eliminace (hustá i pásová), vlastní čísla malých matic
  decompose.js        rozklad proměnných na příspěvky členů rovnic, šipky diagramu (uzavřená i otevřená)
  index.js            veřejné API: simulate(spec, mode), spec.economy = 'closed' | 'open'
src/game/             logika hry „Buď ČNB“: bez DOM, pokrytá testy
  rng.js              seedovaný generátor (mulberry32) a normální rozdělení
  game.js             šoky, šum v datech, pozorování se zpožděním, tah hráče, odvolání
  evaluate.js         ztrátová funkce, autopilot, pravidlo na datech hráče, pravidlový rozbor chyb
  economy.js          hra nad uzavřenou nebo otevřenou ekonomikou (stejné rozhraní krok / start / cesta)
src/scenarios.js      připravené scénáře (čistá data, testované)
src/ui/               vykreslování: app.js, chart.js a bars.js (vlastní SVG grafy), diagram.js,
                      live.js (diagram + rozklad), timeline.js, game.js (obrazovky hry), i18n.js, styles.css
locales/cs.json, en.json  všechny texty rozhraní (výchozí čeština)
test/                 unit testy (node:test)
scripts/serve.mjs     minimální statický server bez závislostí
```

## Model

Čtvrtletní frekvence. Všechny proměnné jsou odchylky od ustáleného stavu v procentech. Inflace a sazby jsou čtvrtletní, mezera výstupu je v % potenciálu.

| Rovnice | |
|---|---|
| **(IS)** Hallova Eulerova rovnice | x<sub>t</sub> = m·E<sub>t</sub>x<sub>t+1</sub> − σ (i<sub>t</sub> − E<sub>t</sub>π<sub>t+1</sub> − rⁿ<sub>t</sub>) |
| **(NKPC)** Phillipsova křivka | π<sub>t</sub> = β·m·E<sub>t</sub>π<sub>t+1</sub> + κ x<sub>t</sub> + u<sub>t</sub> |
| **(TR)** Taylorovo pravidlo s dolní mezí | i<sub>t</sub> = max(i<sub>LB</sub>, φ<sub>π</sub>π<sub>t</sub> + φ<sub>x</sub>x<sub>t</sub> + v<sub>t</sub>) |

- x = mezera výstupu, π = inflace, i = nominální sazba, rⁿ = přirozená sazba (poptávkový šok), u = nákladový šok, v = měnový šok.
- Šoky jsou AR(1), z<sub>t</sub> = ρ z<sub>t−1</sub>, nebo „schod“ (konstantní N čtvrtletí, pak nula, předem známý).
- m je volitelné kognitivní diskontování očekávání (Gabaix 2020). Výchozí m = 1 je učebnicový model.
- **Kalibrace:** β = 0,99, σ = 1, κ = 0,1, φ<sub>π</sub> = 1,5, φ<sub>x</sub> = 0,125 (= 0,5 v anualizovaných sazbách), ρ = 0,8.
- **Úrovně v UI** (anualizovaně): π [% p.a.] = 4π + π\*, i [% p.a.] = 4i + r\* + π\*, reálná sazba = 4(i − E<sub>t</sub>π<sub>t+1</sub>) + r\*, přirozená = 4rⁿ + r\*. Výchozí π\* = 2 %, r\* = 1 %, dolní mez 0 %. Velikosti šoků se zadávají v p. b. p.a. a dělí se 4.
- r\* = 1 % je jen zobrazovací parametr pro úrovně. Formálně β = 0,99 implikuje ustálenou reálnou sazbu asi 4 % p.a. Toto zjednodušení je u výukových verzí modelu běžné.

## Řešicí metody

### Racionální očekávání

1. **Metoda neurčitých koeficientů** (`mucCoefficients`). Pro AR(1) šok z s perzistencí ρ hádáme x = a z, π = b z. Dosazení dá lineární soustavu 2×2:

   ```
   a (1 − mρ + σφx) + b σ(φπ − ρ) = σ (c_rn − c_v)
   −κ a + b (1 − βmρ)              = c_u
   ```

   Kombinace šoků se sčítají (linearita). Tato metoda se použije, když jsou všechny šoky AR(1) a nominální sazba nikde neklesne pod mez.

2. **Dokonalé předvídání** (`solvePF`) pro deterministické scénáře (schod, zpoždění, forward guidance) a pro scénáře, ve kterých mez váže. Neznámé x<sub>t</sub>, π<sub>t</sub>, i<sub>t</sub> pro t = 0…T−1 (T = max(60, horizont + 40)) tvoří jeden lineární systém 3T×3T s terminální podmínkou x<sub>T</sub> = π<sub>T</sub> = 0. Řeší se Gaussovou eliminací s částečnou pivotací. Pro každé čtvrtletí obsahuje soustava řádek IS, řádek NKPC a buď Taylorovo pravidlo, nebo pevnou sazbu.

3. **Dolní mez: guess-and-verify přes režimy.** Začne se odhadem „mez neváže nikde“. Po každém řešení se pro každé čtvrtletí přepočte stínová sazba φ<sub>π</sub>π + φ<sub>x</sub>x + v. Čtvrtletí mimo mez, kde je sazba pod mezí, se přidají do množiny vazby, a čtvrtletí na mezi, kde stínová sazba vystoupala nad mez, se z ní odeberou. Opakuje se, dokud se množina nemění, nebo dokud se režim nezačne cyklit (pak UI zobrazí varování). Výsledek splňuje komplementaritu: na mezi je stínová sazba ≤ mez, mimo mez platí pravidlo.

4. **Forward guidance:** sazba je vynucená na mezi pro t < (konec šoku + N). **Zpoždění:** sazba je na neutrální úrovni pro t < L.

### Determinace

Bez šoků E<sub>t</sub>z<sub>t+1</sub> = A z<sub>t</sub>, z = (x, π), kde

```
A = [ (1 + σφx + σκ/(βm))/m ,  σ(φπ − 1/(βm))/m ]
    [ −κ/(βm)               ,  1/(βm)            ]
```

Obě proměnné hledí dopředu, takže jednoznačné ohraničené řešení existuje právě tehdy, když obě vlastní čísla leží mimo jednotkový kruh (Blanchard–Kahn). Pro m = 1 je to totéž co Taylorův princip κ(φ<sub>π</sub> − 1) + (1 − β)φ<sub>x</sub> > 0 (Bullard & Mitra 2002). Test tuto shodu ověřuje na 2000 náhodných kalibracích. Při neurčitosti racionální režim nekreslí žádnou cestu a místo ní vysvětlí, proč řešení není jednoznačné. Test zároveň zkonstruuje ohraničenou „sunspot“ cestu z vlastního vektoru stabilního kořene, která rovnice splňuje bez jakéhokoli šoku.

### Hybridní/adaptivní očekávání

E<sub>t</sub>π<sub>t+1</sub> = w<sub>t</sub>·0 + (1 − w<sub>t</sub>)π<sub>t−1</sub> (0 = cíl v odchylkách), E<sub>t</sub>x<sub>t+1</sub> = x<sub>t−1</sub>. Řeší se krokováním vpřed: v každém čtvrtletí se dosadí NKPC a pravidlo do IS a vyřeší se x. Pokud by sazba vyšla pod mezí, nastaví se na mez a dopočítají se x a π. Protože sazba daná pravidlem je klesající funkcí skutečné sazby, je řešení i = max(mez, T(i)) jednoznačné.

**Endogenní ukotvení** (volitelné): paměť odchylek s<sub>t</sub> = (1 − λ)s<sub>t−1</sub> + λ|4π<sub>t</sub>|, důvěra, kterou si banka takovým výsledkem „zaslouží“, w\*<sub>t</sub> = w̄ · exp(−max(0, s<sub>t</sub> − pásmo)/pásmo), a w<sub>t+1</sub> = w<sub>t</sub> + g·(w\*<sub>t</sub> − w<sub>t</sub>). V laboratoři je g = 1, tedy w<sub>t+1</sub> = w\*<sub>t</sub>: důvěra klesá jen při dlouhodobém úniku inflace z pásma a po návratu se obnovuje. Hra používá g = 0,3 a start pod stropem (w<sub>0</sub> = 0,6, w̄ = 0,9), takže důvěru je potřeba si postupně vybudovat.

**Krokové API.** `stepHybrid(p, stav, šok, sazba | null)` spočítá jedno čtvrtletí ze stavu (x<sub>t−1</sub>, π<sub>t−1</sub>, w<sub>t</sub>, s<sub>t−1</sub>) a vrátí nový stav. Vynucená sazba pod dolní mezí se zvedne na mez, `null` znamená Taylorovo pravidlo s mezí. `solveHybrid` je jen smyčka přes `stepHybrid`. Šoky lze zadat jako seznam specifikací, nebo jako hotové cesty `{rn, u, v}`, a politiku i jako explicitní sazby `policy.rates` (oba režimy).

## Živý diagram a rozklad na příspěvky (fáze 2)

Každá proměnná se v každém čtvrtletí rozloží přímo z výsledku řešiče na příspěvky členů své rovnice (`decompose.js`, žádný další řešič):

| Proměnná | Příspěvky |
|---|---|
| mezera x (IS) | m·E<sub>t</sub>x<sub>t+1</sub> (očekávaná poptávka) + σ·E<sub>t</sub>π<sub>t+1</sub> (očekávaná inflace) − σ·i<sub>t</sub> (nominální sazba) + σ·rⁿ<sub>t</sub> (přirozená sazba) |
| inflace π (NKPC) | β·m·E<sub>t</sub>π<sub>t+1</sub> (očekávání) + κ·x<sub>t</sub> (mezera) + u<sub>t</sub> (nákladový šok) |
| sazba i (TR) | φ<sub>π</sub>π<sub>t</sub> + φ<sub>x</sub>x<sub>t</sub> + v<sub>t</sub> + (max(mez, s<sub>t</sub>) − s<sub>t</sub>) (dolní mez) + (i<sub>t</sub> − max(mez, s<sub>t</sub>)) (mimo pravidlo: zpoždění, slib, ve hře hráč), s<sub>t</sub> = stínová sazba |

Mezera zůstává v % potenciálu, příspěvky k inflaci a sazbě se anualizují (×4, tedy p. b. p.a. vůči cíli a vůči neutrální sazbě). Test ověřuje, že součet příspěvků se rovná proměnné s chybou < 1e-9 ve všech režimech, na mezi, se slibem, zpožděním i diskontováním.

- **Diagram:** Očekávání nahoře, pod nimi Poptávka → Inflace → Centrální banka a oblouky zpět: φ<sub>x</sub>x (poptávka → banka) a −σ·i (sazba → poptávka, zpětná vazba). Šoky rⁿ, u, v a „mez / mimo pravidlo“ vstupují shora. Šipky do uzlu se sčítají přesně na jeho hodnotu. Tloušťka a rychlost pulzování jsou úměrné velikosti příspěvku (jedno měřítko pro celé období), teplá barva zvyšuje, studená snižuje. Tečkované šipky ukazují, odkud se berou očekávání: v racionálním režimu z budoucnosti (t+1), v hybridním z minulosti (t−1). Kanály, které jsou po celé období nulové, se skryjí.
- **Rozklad v číslech:** vedle diagramu rovnice s čísly pro zvolené čtvrtletí a věta o největším příspěvku.
- **Skládané sloupce:** jeden graf na rovnici, kladné příspěvky nad nulou, záporné pod ní, tečky = součet.
- **Časová osa:** přehrát, krokovat, na začátek, posuvník. Je sdílená s grafy laboratoře: najetí na graf posune časovou osu a obráceně. V režimu „Obě“ i se srovnávacím během lze zvolit, který běh diagram ukazuje.

## Hra „Buď ČNB“ (fáze 2)

Hráč každé čtvrtletí nastaví nominální sazbu (krok 0,25 p. b., ne pod dolní mez). Délka je nastavitelná (8–40, výchozí 24 čtvrtletí), před ní jsou 4 čtvrtletí historie, ve kterých banka postupovala podle Taylorova pravidla. Logika je v `src/game/` bez DOM.

- **Model:** hybridní očekávání s endogenním ukotvením (w<sub>0</sub> = 0,6, strop w̄ = 0,9, rychlost g = 0,3, pásmo 1 p. b.). Racionální očekávání by vyžadovala známé pravidlo, které hráč nemá. Hráčova cesta = `solveHybrid` s jeho sazbami, test to ověřuje proti krokování.
- **Šoky (p. b. p.a.):** AR(1) pro rⁿ (ρ = 0,7, σ = 0,4) a u (ρ = 0,7, σ = 0,4), navíc vzácné velké události s pravděpodobností 6 % za čtvrtletí (rⁿ: ±3,5σ, častěji dolů; u: ±4σ, častěji nahoru). O událostech hráč dostane hned slovní zprávu, bez čísel. Obtížnost násobí šoky: mírná ×0,6, střední ×1, těžká ×1,35. Poptávkové šoky jsou záměrně menší: s adaptivními očekáváními se dlouhý pobyt na mezi může změnit v deflační past (při těžké obtížnosti se to vzácně stane).
- **Seed:** generátor mulberry32 bere v každém čtvrtletí pevný blok losování (2 inovace, 2 události, 3 šumy). Stejný seed dá stejnou hru a delší hra se stejným seedem začíná stejnými čtvrtletími. Výchozí seed je 1998, rok přechodu ČNB na cílování inflace.
- **Pozorování:** v čtvrtletí t hráč vidí jen data za čtvrtletí < t jako první odhady se šumem (směrodatná odchylka: inflace 0,3 p. b., mezera 0,9 %, inflační očekávání z průzkumu 0,2 p. b.). Skutečné hodnoty a skóre během hry nevidí.
- **Odvolání:** když skutečná inflace uteče o víc než 10 p. b. od cíle, nebo mezera přesáhne ±12 %, vláda hráče odvolá a vyhodnotí se odehraná čtvrtletí.
- **Ztráta:** L = Σ [(π − π\*)² + 0,5·x² + 0,25·(Δi)²] přes hráčova čtvrtletí, π a i v % p.a., x v % potenciálu.
- **Srovnání:** *autopilot* = `solveHybrid` s Taylorovým pravidlem modelu na stejných šocích (vidí skutečná aktuální data, má informační výhodu) a *pravidlo na tvých datech* = stejné pravidlo použité na zpožděná zašuměná data hráče, zaokrouhlené na 0,25 p. b. Grafy přes sebe, tabulka ztrát, graf šoků a živý diagram každého běhu.
- **Pravidlový rozbor chyb** (`RULES` v `evaluate.js`). Vodítkem je Taylorovo pravidlo na datech, která hráč viděl, R = r\* + π\* + φ<sub>π</sub>(π − π\*) + 4φ<sub>x</sub>x, nejníž na dolní mezi:
  - *pozdní reakce:* aspoň 2 čtvrtletí po sobě data i skutečnost ukazují inflaci mimo pásmo ±1 p. b., sazba je o víc než 0,75 p. b. na špatné straně R a nehne se o víc než 0,25 p. b. správným směrem;
  - *přehnaná reakce:* pohyb aspoň o 0,75 p. b. směrem, který data naznačovala, přenese sazbu o víc než 1,25 p. b. za R a do 4 čtvrtletí ekonomika přestřelí na druhou stranu (inflace za pásmo, nebo mezera za ±2 %);
  - *reakce na šum:* pohyb aspoň o 0,5 p. b. stejným směrem, jakým ukazoval šum měření (šum vysvětluje aspoň 0,6 p. b. a aspoň polovinu pohybu), zatímco skutečná data ospravedlňovala méně než polovinu pohybu;
  - *uvolnění při nabídkovém šoku:* nákladový šok u > 0,5 p. b., inflace v datech nad cílem a snížení sazby aspoň o 0,25 p. b. pod R.
  
  Na jedno rozhodnutí připadá nejvýš jeden jednorázový nález (priorita: nabídkový šok > přehnaná reakce > šum). Nálezy se řadí podle toho, kolik stály: rozdíl ztráty hráče a autopilota v daném a následujících 4 čtvrtletích. Texty jsou šablony v `locales/`, žádný jazykový model.

## Malá otevřená ekonomika (fáze 3)

Přepínač **Uzavřená / Otevřená** je v laboratoři i ve hře. Uzavřený model zůstává beze změny. Otevřený model je zjednodušená malá otevřená ekonomika ve stylu Galí & Monacelli (2005), zapsaná v polostrukturní podobě, kterou používají centrální banky s cílováním inflace. Místo úplného sdílení rizika obsahuje nekrytou úrokovou paritu s rizikovou prémií, takže lze zkoumat šoky kurzu a kurzový závazek. Proměnné jsou čtvrtletní odchylky v %. q je reálný kurz (kladný = slabší koruna) a e = q + p<sup>H</sup> je nominální kurz (zahraniční ceny jsou konstantní).

| Rovnice | |
|---|---|
| **(IS)** poptávka = domácí poptávka + čistý vývoz | x<sub>t</sub> = c<sub>t</sub> + δ q<sub>t</sub> + γ y\*<sub>t</sub>,  c<sub>t</sub> = m·E<sub>t</sub>c<sub>t+1</sub> − σ (i<sub>t</sub> − E<sub>t</sub>π<sup>H</sup><sub>t+1</sub> − rⁿ<sub>t</sub>) |
| **(NKPC)** inflace domácího zboží | π<sup>H</sup><sub>t</sub> = β·m·E<sub>t</sub>π<sup>H</sup><sub>t+1</sub> + κ x<sub>t</sub> + u<sub>t</sub> |
| **(CPI)** spotřebitelská inflace | π<sub>t</sub> = (1 − α) π<sup>H</sup><sub>t</sub> + α π<sup>F</sup><sub>t</sub>,  π<sup>F</sup><sub>t</sub> = ψ (d<sub>t−1</sub> + Δe<sub>t</sub>),  d<sub>t</sub> = (1 − ψ)(d<sub>t−1</sub> + Δe<sub>t</sub>) |
| **(UIP)** nekrytá úroková parita | q<sub>t</sub> = E<sub>t</sub>q<sub>t+1</sub> − (i<sub>t</sub> − E<sub>t</sub>π<sup>H</sup><sub>t+1</sub> − i\*<sub>t</sub>) + χ<sub>t</sub> + ξ<sub>t</sub> |
| **(TR)** pravidlo s dolní mezí | i<sub>t</sub> = max(i<sub>LB</sub>, φ<sub>π</sub>[(1 − ω)π<sub>t</sub> + ω π<sup>H</sup><sub>t</sub>] + φ<sub>x</sub>x<sub>t</sub> + v<sub>t</sub>) |
| **kurzový závazek** | e<sub>t</sub> ≥ ē, ξ<sub>t</sub> ≥ 0, ξ<sub>t</sub>(e<sub>t</sub> − ē) = 0 (intervence jen na hranici) |

- **Zahraniční šoky:** i\* = zahraniční sazba (p. b. p.a., dělí se 4), y\* = zahraniční poptávka (% potenciálu), χ = riziková prémie, tedy šok kurzu (p. b. p.a., dělí se 4).
- **Kalibrace:** α = 0,35 (podíl dovozu v CPI), δ = 0,1 (čistý vývoz na 1 % reálného oslabení), γ = 0,5 (na 1 % zahraniční mezery), ψ = 0,2 (rychlost přenosu kurzu do cen dovozu za čtvrtletí), θ = 0,8 (očekávání kurzu v hybridním režimu), ω = 0 (banka reaguje na CPI), výchozí kurz 25,7 CZK/EUR (jen pro zobrazení).
- **Proč ψ = 0,2:** s rychlým přenosem (ψ = 0,5) se pravidlo reagující se zpožděním na CPI rozkmitá. Sazba hned pohne kurzem, kurz hned pohne cenami dovozu a pravidlo o čtvrtletí později odpoví ještě silněji (zisk smyčky > 1). Ve hře pak pravidlo na zašuměných datech končilo odvoláním v 90 % her. Pomalý přenos odpovídá i datům.
- **Racionální očekávání:** dokonalé předvídání přes T = max(130, horizont + 90) čtvrtletí s terminální podmínkou c<sub>T</sub> = π<sup>H</sup><sub>T</sub> = q<sub>T</sub> = 0. Pro AR(1) šoky je to totéž co racionální očekávání (jistotní ekvivalence), useknutí horizontu dělá v zobrazeném okně chybu pod 1e-4. Soustava má 9 neznámých na čtvrtletí (x, c, π<sup>H</sup>, π, π<sup>F</sup>, d, q, i, p<sup>H</sup>) a každá rovnice spojuje jen t − 1, t a t + 1. Při řazení podle času je tedy pásová a řeší se Gaussovou eliminací v pásu (`solveBanded`) za O(n·b²) místo O(n³). Dolní mez i hranici kurzu řeší guess-and-verify současně přes dvě množiny režimů: na hranici se řádek UIP nahradí podmínkou e<sub>t</sub> = ē a ověřuje se ξ<sub>t</sub> ≥ 0, mimo ni e<sub>t</sub> ≥ ē.
- **Hybridní očekávání:** E c<sub>t+1</sub> = c<sub>t−1</sub>, E π<sup>H</sup><sub>t+1</sub> = (1 − w<sub>t</sub>)π<sup>H</sup><sub>t−1</sub> a regresivní očekávání kurzu E q<sub>t+1</sub> = θ q<sub>t</sub> (Dornbusch), takže kurz reaguje na úrokový rozdíl ve stejném čtvrtletí. Všechny současné proměnné jsou afinní v sazbě i a v intervenci ξ, proto se krok (`stepOpen`) vyřeší přesně: nejdřív pravidlo s mezí, a když by koruna byla silnější než hranice, dopočítá se ξ tak, aby e = ē.
- **Determinace:** E z<sub>t+1</sub> = A z<sub>t</sub> pro z = (c, π<sup>H</sup>, q, q<sub>t−1</sub>, d<sub>t−1</sub>). Tři proměnné hledí dopředu, takže jednoznačnost vyžaduje tři vlastní čísla mimo jednotkový kruh. Vlastní čísla 5×5 matice se počítají z charakteristického polynomu (Faddeev–LeVerrier, Durand–Kerner). Jedno vlastní číslo je vždy přesně 1: trvalé reálné oslabení vyrovnané nižší domácí poptávkou nemění výstup, inflaci ani sazbu. Jako v jiných modelech s UIP bez stabilizačního členu ho ukotvuje dlouhodobá podmínka q<sub>∞</sub> = c<sub>∞</sub> = 0, a proto se počítá k nestabilním kořenům.
- **Rozklad a diagram:** poptávka = očekávaná domácí poptávka + očekávaná inflace − sazba + přirozená sazba + čistý vývoz (δq) + zahraniční poptávka (γy\*); CPI = (1 − α)·[očekávání + mezera + šok] + α·π<sup>F</sup>; kurz = očekávaný kurz + očekávaná inflace − domácí sazba + zahraniční sazba + prémie + intervence. V diagramu přibývá uzel **Kurz koruny** se šipkami od banky (sazba, intervence) a od očekávání. Šipky od něj vedou k inflaci (ceny dovozu) a k poptávce (čistý vývoz, oblouk přes horní okraj). Testy ověřují, že se šipky do každého uzlu sečtou na jeho hodnotu.
- **Scénář 5, kurzový závazek ČNB (2013–2017):** domácí propad poptávky (−2 p. b.), recese v eurozóně (y\* −1,5 %) a nízké sazby ECB (i\* −1 p. b.) na 10 čtvrtletí. Banka se dívá skrz dovozní inflaci (ω = 1) a od 1. čtvrtletí po dobu 12 čtvrtletí nedovolí posílení koruny pod 27 CZK/EUR. V racionálním režimu závazek odvrátí deflaci (bez něj CPI −5 %, se závazkem kolem cíle) a ztrátu sníží zhruba čtyřikrát, hlavně přes očekávání vyšší inflace na nulové mezi. Těsně před koncem závazku prudce rostou intervence, protože trh čeká posílení. V hybridním režimu bez kanálu očekávání závazek pomáhá málo. Přepnutí na ω = 0 ukazuje, jak by banka reagující na CPI závazek sama podkopala.
- **Hra v otevřené ekonomice:** stejná pravidla, navíc zahraniční šoky ze samostatného proudu téhož seedu, takže domácí šoky jsou stejné jako v uzavřené hře. Zahraniční sazba: AR(1), ρ = 0,9, σ = 0,15. Zahraniční poptávka: ρ = 0,8, σ = 0,4, události 5 %, ±3σ, častěji dolů. Prémie: ρ = 0,7, σ = 0,7, události 5 %, ±3,5σ, častěji oslabení. Kurz hráč vidí přesně a hned, protože jde o tržní cenu, ostatní data jako dřív. Vyhodnocení přidává graf kurzu, zahraniční šoky a diagram s kurzem.

### Ověření

Unit testy (`npm test`, celkem 145):

- dosazení řešení do rovnic dá rezidua < 1e-9 pro všechny typy šoků, oba režimy, dolní mez, forward guidance, zpoždění a diskontování;
- metoda dokonalého předvídání konverguje k analytickému řešení neurčitými koeficienty;
- znaménka: poptávkový propad snižuje x i π; nákladový šok zvyšuje π a při Taylorově pravidle snižuje x; měnové zpřísnění snižuje x i π (v obou režimech);
- nominální sazba nikdy pod dolní mezí (150 náhodných kalibrací × 2 režimy) a bez šoků model zůstává v ustáleném stavu;
- komplementarita režimů na mezi; forward guidance zvyšuje výstup, delší slib má větší účinek (hádanka) a diskontování ho tlumí;
- determinace: analytická podmínka = test vlastních čísel; neurčitost ⇔ existuje ohraničená sunspot cesta; racionální režim při neurčitosti nevrací žádné cesty;
- endogenní ukotvení klesá a obnovuje se; pozdní reakce vede k vyšší kumulativní inflaci;
- všechny připravené scénáře se vyřeší přesně a oba překlady mají stejné klíče;
- rozklad: součet příspěvků = proměnná (< 1e-9) a šipky do uzlu diagramu se sečtou na jeho hodnotu, mez a slib se projeví ve správném členu;
- krokové API: krokování po čtvrtletích dá přesně `solveHybrid`, vstupní stav se nemění, sazba pod mezí se zvedne na mez, pomalé ukotvení roste u cíle a klesá při úniku inflace;
- hra: stejný seed = stejné šoky, šum, zprávy i výsledek; delší hra začíná stejně; obtížnost škáluje šoky a ne šum; hráč vidí jen zpožděná zašuměná data; šum mezery je větší než šum inflace; zaokrouhlení a mez sazby; autopilot = `solveHybrid` se stejnými šoky; ztráta na ručně spočítaném případu; odvolání;
- rozbor: každé pravidlo na připraveném případu (pozdní reakce, přehnaná reakce, reakce na šum, uvolnění při nabídkovém šoku), klidná hra bez výtek, žádná „reakce na šum“, když data byla pravdivá, řazení podle ceny;
- otevřená ekonomika: bez obchodu (α = δ = γ = 0) se shoduje s uzavřeným modelem na 1e-9 v obou režimech (i se slibem a zpožděním); rezidua < 1e-9 pro všechny šoky, mez, hranici kurzu, ω, diskontování i okamžitý přenos; pásový řešič = hustý; krokování = celá cesta; dostatečný horizont;
- otevřená ekonomika, znaménka: zahraniční recese snižuje výstup i domácí inflaci a oslabuje korunu; šok prémie a vyšší zahraniční sazba korunu oslabí a zvednou CPI; zpřísnění korunu posílí a CPI reaguje rychleji než v uzavřené ekonomice; bez šoků ustálený stav;
- otevřená ekonomika, mez a závazek: sazba nikdy pod mezí a koruna nikdy pod hranicí (60 náhodných kalibrací × 2 režimy), intervence jen jedním směrem a jen přesně na hranici, závazek v racionálním režimu odvrací deflaci; determinace (výchozí ano, pasivní pravidlo ne, bez obchodu shodně s uzavřeným modelem na 300 kalibracích); rozklad a šipky čtyř uzlů;
- hra v otevřené ekonomice: opakovatelnost, domácí šoky shodné s uzavřenou hrou, kurz viditelný přesně, hra = `solveOpenHybrid` s hráčovými sazbami, autopilot = `solveOpenHybrid` s pravidlem, pravidlo na datech je stabilní (žádné odvolání na 40 seedech), vyšší sazba posílí korunu ve stejném čtvrtletí;
- uzavřené hry se stejným seedem dávají přesně stejné šoky jako ve fázi 2 (ověřeno proti commitu fáze 2).

UI navíc u každého běhu zobrazí použitou metodu a maximální reziduum.

## Scénáře (fáze 1)

1. **Ropný/energetický šok:** nákladový šok, dilema inflace vs. výkon, srovnání s jestřábí bankou (φ<sub>π</sub> = 3).
2. **Propad poptávky:** pokles přirozené sazby, srovnání s Hallovou σ = 0,2.
3. **Nulová mez + forward guidance:** schod −5 p. b. na 6 čtvrtletí, slib držet sazbu na mezi N čtvrtletí po konci šoku, srovnání se slibem a bez něj, hádanka forward guidance a parametr m.
4. **Odkotvení očekávání:** nákladový šok, zpožděná reakce banky, endogenní ukotvení v hybridním režimu, srovnání s včasnou reakcí.
5. **Kurzový závazek ČNB (2013–2017)** (fáze 3, jen otevřená ekonomika): viz výše.

Scénáře 1–4 i vlastní šok lze spustit i v otevřené ekonomice a porovnat s uzavřenou přes připnuté běhy. Vlastní šok v otevřené ekonomice nabízí i zahraniční sazbu, zahraniční poptávku a šok kurzu.

Každý běh lze spustit racionálně, hybridně, nebo v obou režimech v jednom grafu. Tlačítkem „Připnout“ lze uložit až 4 běhy a překrýt je s dalšími.

## Literatura

- Woodford, M. (2003). *Interest and Prices: Foundations of a Theory of Monetary Policy.* Princeton University Press.
- Hall, R. E. (1988). Intertemporal Substitution in Consumption. *Journal of Political Economy* 96(2).
- Bullard, J., Mitra, K. (2002). Learning about Monetary Policy Rules. *Journal of Monetary Economics* 49(6).
- Del Negro, M., Giannoni, M., Patterson, C. (2012/2023). The Forward Guidance Puzzle.
- McKay, A., Nakamura, E., Steinsson, J. (2016). The Power of Forward Guidance Revisited. *American Economic Review* 106(10).
- Gabaix, X. (2020). A Behavioral New Keynesian Model. *American Economic Review* 110(8).
- Galí, J., Monacelli, T. (2005). Monetary Policy and Exchange Rate Volatility in a Small Open Economy. *Review of Economic Studies* 72(3).
- Svensson, L. E. O. (2000). Open-Economy Inflation Targeting. *Journal of International Economics* 50(1).
- Dornbusch, R. (1976). Expectations and Exchange Rate Dynamics. *Journal of Political Economy* 84(6).
- Schmitt-Grohé, S., Uribe, M. (2003). Closing Small Open Economy Models. *Journal of International Economics* 61(1).
- Berg, A., Karam, P., Laxton, D. (2006). Practical Model-Based Monetary Policy Analysis: A How-To Guide. IMF Working Paper 06/81.
- Franta, M., Holub, T., Král, P., Kubicová, I., Šmídková, K., Vašíček, B. (2014). The Exchange Rate as an Instrument at Zero Interest Rates: The Case of the Czech Republic. ČNB Research and Policy Notes 3/2014.
