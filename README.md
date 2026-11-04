# Laboratoř novokeynesiánského modelu / NK Model Lab

Interaktivní výuková simulace tříčlenného novokeynesiánského modelu (Woodford, *Interest and Prices*, 2003), která ukazuje, jak spolu souvisí poptávka, inflace, sazby a očekávání.

> **Výukový model s učebnicovou kalibrací, ne předpověď.** Čísla ilustrují mechanismy a nepopisují českou ani jinou skutečnou ekonomiku.

Stav: **Fáze 1, laboratoř šoků.** Fáze 2–4 (živý diagram a hra „Buď ČNB“, malá otevřená ekonomika, agentní simulace) zatím chybí.

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
  hybrid.js           hybridní/adaptivní očekávání, krokování vpřed, endogenní ukotvení
  check.js            rezidua (dosazení řešení zpět do rovnic)
  index.js            veřejné API: simulate(spec, mode)
src/scenarios.js      připravené scénáře (čistá data, testované)
src/ui/               vykreslování: app.js, chart.js (vlastní SVG grafy), i18n.js, styles.css
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

**Endogenní ukotvení** (volitelné): paměť odchylek s<sub>t</sub> = (1 − λ)s<sub>t−1</sub> + λ|4π<sub>t</sub>| a w<sub>t+1</sub> = w̄ · exp(−max(0, s<sub>t</sub> − pásmo)/pásmo). Důvěra tedy klesá jen při dlouhodobém úniku inflace z pásma a po návratu se obnovuje.

### Ověření

Unit testy (`npm test`, celkem 41):

- dosazení řešení do rovnic dá rezidua < 1e-9 pro všechny typy šoků, oba režimy, dolní mez, forward guidance, zpoždění a diskontování;
- metoda dokonalého předvídání konverguje k analytickému řešení neurčitými koeficienty;
- znaménka: poptávkový propad snižuje x i π; nákladový šok zvyšuje π a při Taylorově pravidle snižuje x; měnové zpřísnění snižuje x i π (v obou režimech);
- nominální sazba nikdy pod dolní mezí (150 náhodných kalibrací × 2 režimy) a bez šoků model zůstává v ustáleném stavu;
- komplementarita režimů na mezi; forward guidance zvyšuje výstup, delší slib má větší účinek (hádanka) a diskontování ho tlumí;
- determinace: analytická podmínka = test vlastních čísel; neurčitost ⇔ existuje ohraničená sunspot cesta; racionální režim při neurčitosti nevrací žádné cesty;
- endogenní ukotvení klesá a obnovuje se; pozdní reakce vede k vyšší kumulativní inflaci;
- všechny připravené scénáře se vyřeší přesně a oba překlady mají stejné klíče.

UI navíc u každého běhu zobrazí použitou metodu a maximální reziduum.

## Scénáře (fáze 1)

1. **Ropný/energetický šok:** nákladový šok, dilema inflace vs. výkon, srovnání s jestřábí bankou (φ<sub>π</sub> = 3).
2. **Propad poptávky:** pokles přirozené sazby, srovnání s Hallovou σ = 0,2.
3. **Nulová mez + forward guidance:** schod −5 p. b. na 6 čtvrtletí, slib držet sazbu na mezi N čtvrtletí po konci šoku, srovnání se slibem a bez něj, hádanka forward guidance a parametr m.
4. **Odkotvení očekávání:** nákladový šok, zpožděná reakce banky, endogenní ukotvení v hybridním režimu, srovnání s včasnou reakcí.

Každý běh lze spustit racionálně, hybridně, nebo v obou režimech v jednom grafu. Tlačítkem „Připnout“ lze uložit až 4 běhy a překrýt je s dalšími.

## Literatura

- Woodford, M. (2003). *Interest and Prices: Foundations of a Theory of Monetary Policy.* Princeton University Press.
- Hall, R. E. (1988). Intertemporal Substitution in Consumption. *Journal of Political Economy* 96(2).
- Bullard, J., Mitra, K. (2002). Learning about Monetary Policy Rules. *Journal of Monetary Economics* 49(6).
- Del Negro, M., Giannoni, M., Patterson, C. (2012/2023). The Forward Guidance Puzzle.
- McKay, A., Nakamura, E., Steinsson, J. (2016). The Power of Forward Guidance Revisited. *American Economic Review* 106(10).
- Gabaix, X. (2020). A Behavioral New Keynesian Model. *American Economic Review* 110(8).
