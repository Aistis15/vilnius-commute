# Pitch demo: run sheet

The demo, step by step. Written in Lithuanian, like the app.

## Dieną prieš

1. Kompiuteryje: `git pull`. Atidaryk `prototype` aplanką, adreso juostoje
   įrašyk `cmd`, Enter, tada **`Paleisti-demo.bat 08:10`**. (Paleistas
   dukart spustelėjus, demo eina dabartiniu laiku.) Atsidaro serveris ir
   Expo QR kodas.
2. iPhone: Expo Go → nuskenuok QR. Programėlė atsidaro visame ekrane.
3. **Išsaugok vietas iš anksto** (paieškai reikia interneto, išsaugotoms vietoms ne):
   *Akropolis* ir *Namai*. Jei pristatai ne ISM pastate, išsaugok ir *ISM*
   (Gedimino pr. 7) ir pasirink ją: Nustatymai → **Iš kur keliauji** → ISM.
4. Perbėk scenarijų **du kartus**. Po kiekvieno karto: Nustatymai →
   Prototipas → **Dabar** (laikas grįžta į 08:10, visi autobusai vėl laiku).
5. Įsirašyk ekrano įrašą (iPhone: Valdymo centras → ekrano įrašas) per vieną
   sėkmingą kartą. Tai **planas B**, jei per pristatymą neveiks Wi-Fi.

## Scenarijus (~2 min)

| # | Darai | Sakai |
|---|---|---|
| 1 | Rodai užrakintą ekraną, spaudi mikrofono mygtuką | „Programėlės net atidaryti nereikia.“ |
| 2 | Sakai: **„Man reikia į Akropolį devynios“** | (balsu, lietuviškai) |
| 3 | Baneris: *Išeik 08:24 · 43 · Akropolis 08:58* | „Ji pati suskaičiavo, kada išeiti, kad būčiau iki devynių.“ |
| 4 | Pulte **Kitas etapas** | Baneris virsta navigacija su posūkiais ir žemėlapiu |
| 5 | **Kitas etapas**, kol pasirodys stotelė | *Lauk stotelėje · 43 atvažiuoja* ir artėjančio autobuso juosta |
| 6 | Pulte **Vėluoja 4 min** | Raudonai *vėluoja 4 min*, laikas persiskaičiuoja. „Autobusas vėluoja, ir programėlė pasako tai pirma.“ |
| 7 | Atrakini → **Žemėlapis** | Visi autobusai juda gatvėmis |

Patikrintos frazės (veikia): „devynios“, „iki devynių“, „devintai valandai“,
„devintą“, „aštuonios penkiasdešimt“, „keturiolika dvidešimt“, „dabar“.
Jei salėje triukšminga ir balsas neatpažįstamas, baneryje atsiranda
**Rašyti**: įvesk tą pačią frazę.

## Ką sakyti apie demo režimą

Autobusų padėtys demo metu imamos iš **tvarkaraščio**, ne iš GPS, o
vėlavimą įjungi ranka. Pasakyk tai vienu sakiniu, pvz.: *„Kad demo
nepriklausytų nuo salės interneto, autobusai rodomi pagal tvarkaraštį;
tikroje versijoje jie ateina iš stops.lt kas sekundę.“* Vertintojas, kuris
pats tai pastebi, dažniausiai vertina prasčiau nei tas, kuriam pasakei pats.

Tikri, išmatuoti skaičiai, kuriuos gali drąsiai sakyti (`prototype/README.md`,
`docs/trafi-analysis.md`):

- Važiuojantis autobusas rodomas apie **18 m** nuo tikrosios vietos (mediana;
  buvo 110 m). Matuota 2026-09-27, Vilnius, 200 s įrašas, ~21 000 matavimų.
- Nauja padėtis programėlę pasiekia per **0,85 s** (mediana) nuo stops.lt paskelbimo.
- Maršrutai skaičiuojami be interneto, iš Vilniaus, Kauno ir Klaipėdos tvarkaraščių.

## Jei kažkas neveikia

| Problema | Ką daryti |
|---|---|
| Expo tunelis neprisijungia | `Paleisti-demo.bat 08:10 lan` (telefonas ir kompiuteris tame pačiame Wi-Fi) arba rodyk kompiuteryje: http://localhost:8765 |
| Nėra interneto | Maršrutai, autobusai ir išsaugotos vietos veikia; žemėlapio fonas bus pilkas. Arba paleisk ekrano įrašą |
| Laikas ne 08:10 | Pulte **Dabar** |
| Balsas nesupranta | **Rašyti**, įvesk tą pačią frazę |
