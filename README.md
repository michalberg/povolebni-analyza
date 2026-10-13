# Povolební analýza – komunální volby 2026, Brno

Statická stránka (GitHub Pages) s analýzou výsledků komunálních voleb 9.–10. 10. 2026
v Brně a městských částech. Navazuje na [vysledkyvoleb](https://github.com/michalberg/vysledkyvoleb)
(design, barvy stran `barvy.json`, zkratky `zkratky.json`, naše kandidátky `config.json`).

## Obsah

Pro **magistrát**, **magistrát v každé z 29 MČ** a **naše kandidátky v 15 MČ**:

- výsledky a změna proti 2022 (srovnatelné kandidátky podle `nastupci.json`),
- výsledky po městských částech (jen magistrát),
- mapa okrsků – podíl, změna, účast, změna účasti,
- přednostní hlasy – osobní hlasy kandidátů po okrscích (odhad: hlasy nad základem okolních míst na kandidátce),
- MČ vs. magistrát – rozdíl mezi oběma lístky ve stejných okrscích (u MČ),
- korelace podílů a změn mezi stranami po okrscích.

Přepínač **přepočítat zvláštní okrsky** nahradí počet voličů v okrscích 23001 a 23018
(Brno-střed, evidenční adresy na úřadě) odhadem z účasti sousedních okrsků.

Sekce **Co mohlo být lepší** a **Konkurence** (včetně komentářů a podezřelých zápisů okrskových
komisí) čtou data z adresáře `interni/`. Ten je součástí repozitáře, takže jsou na webu veřejně
viditelné. Lokálně:

```bash
python3 -m http.server 8765   # pak http://127.0.0.1:8765/
```

## Data

`data/` i `interni/` generuje skript `povolebni.py` v projektu *volebnidata*:

```bash
.venv/bin/python povolebni.py --site ../povolebni-analyza
```

Zdroje: otevřená data volby.gov.cz (KV 2026, KV 2022), adresní body volebních okrsků ČÚZK
(polygony okrsků = Voronoiovy buňky adresních bodů, přibližné). Názvy okrsků z tabulky
navržených názvů okrsků.

| Soubor | Obsah |
|---|---|
| `data/index.json` | přehled celků a MČ |
| `data/<kód>.json` | výsledky celku: kandidátky 2026/2022, okrsky (hlasy, voliči, 2022 přemapované na kandidátky 2026) |
| `data/kandidati/<kód>-<pořadí>.json` | kandidáti a jejich hlasy po okrscích (osobní hlasy = hlasy nad dolní čtvrtinou kandidátů ±5 míst na kandidátce, počítá se v prohlížeči) |
| `data/okrsky.geojson` | polygony okrsků |
| `data/ciselnik.json` | číselníky politické příslušnosti a navrhujících stran |
| `nastupci.json` | ručně ověřené přiřazení kandidátek 2022 → 2026 (s poznámkami) |
