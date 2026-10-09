# Pitch demo: run sheet

The demo, step by step. Written in Lithuanian, like the app.

## Prieš pristatymą (pitchas ~13:00, scenarijus ISM → OZAS)

**Mac'e, be jokios programėlės:** `cd ~/vilnius-commute && git pull && bash prototype/paleisti-mac.sh`.
Terminale atsiranda QR kodas. Nuskenuok jį iPhone kamera, Safari spausk Bendrinti →
**Pridėti prie pradžios ekrano** ir atidaryk „Vilnius“ nuo pradžios ekrano.
Vietas (OZAS) išsaugok jau ten: pradžios ekrano programėlė turi savo atmintį.

1. Kompiuteryje: `git fetch`, `git checkout claude/dreamy-wright-qx3kbl`,
   tada du kartus spustelėk **`prototype/Paleisti-demo.bat`**. Laikas lieka
   tikras, todėl sutampa su telefono laikrodžiu. Atsidaro serveris ir Expo QR kodas.
2. iPhone: Expo Go → nuskenuok QR.
3. **Privatumas:** Nustatymai → Mano vietos → ištrink *Namai* ir kitas
   asmenines vietas. Jos rodomos pradžios ekrane.
4. **Išsaugok OZĄ:** paieškoje įvesk `Ozo g. 18` ir išsaugok kaip **OZAS**.
   Paieška pagal žodį „Ozas“ pirmiausia randa rajoną, ne prekybos centrą.
   Išsaugota vieta balsu randama pirmiausia.
5. Pradžios vieta: GPS (esi ISM). Jei GPS netikslus: Nustatymai →
   **Iš kur keliauji** → ISM.
6. Perbėk scenarijų bent kartą. Po to pulte **Dabar** (visi autobusai vėl laiku).
   Įsirašyk ekraną kaip planą B.

## Scenarijus (~2 min)

| # | Darai | Sakai |
|---|---|---|
| 1 | Užrakintas ekranas, spaudi mikrofoną | „Programėlės net atidaryti nereikia.“ |
| 2 | Sakai: **„Man reikia į OZĄ iki antros“** | |
| 3 | Baneris, pvz., *Išeik 13:25 · 53 · OZAS 13:52* | „Pati suskaičiavo, kada išeiti, kad būčiau iki antros.“ |
| 4 | Pulte **Kitas etapas** | Baneris virsta navigacija su posūkiais |
| 5 | **Kitas etapas**, kol pasirodys stotelė | *Lauk stotelėje · 53 atvažiuoja* ir artėjančio autobuso juosta |
| 6 | Pulte **Vėluoja 4 min** | Raudonai *vėluoja 4 min*, laikai persiskaičiuoja |
| 7 | Atrakini → **Žemėlapis** | Autobusai juda gatvėmis |

Laikas: frazę rinkis taip, kad iki jo liktų bent 40 min (ISM → OZAS trunka ~30 min).
Jei kalbi po 13:20, sakyk **„iki pusės trečios“** arba tiesiog **„dabar“**.
Patikrintos frazės: „iki antros“, „antrą valandą“, „keturiolika“, „dabar“,
„keturiolika trisdešimt“. Jei balsas neatpažįstamas, baneryje atsiranda
**Rašyti**: įvesk tą pačią frazę.

„Po to į Sapiegų parką“ (antras tikslas) **nesakyk**: parseris jį supranta,
bet programėlė antro tikslo dar nenaudoja.

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
| Balsas nesupranta | **Rašyti**, įvesk tą pačią frazę |
