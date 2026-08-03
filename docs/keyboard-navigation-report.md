# Testare completă doar-tastatură

Criteriul rămas din #10 (M4): "testare zoom 200% + navigare completă doar cu
tastatura". Zoom-ul e acoperit deja de audit-ul axe/Lighthouse anterior (layout
fluid, fără puncte de întrerupere care rup conținutul). Acest raport acoperă
partea de navigare doar-tastatură, cu Playwright, împotriva unui build de
producție local.

## Metodologie

Pentru fiecare pagină publică (`/`, `/teritorii`, `/teritorii?limit=5`,
`/teritorii/{id}`, `/date`, o pagină 404), am apăsat `Tab` repetat de la
`document.body` și am comparat elementele efectiv atinse cu toate elementele
focusabile vizibile din pagină (identificate prin identitate DOM, nu text —
textul se poate repeta, ex. linkul "Registru" apare atât în navigare cât și în
breadcrumb). Conținutul dintr-un `<details>` colaps a fost exclus din setul
"așteptat": browserul îl exclude corect din ordinea de tab cât timp e închis —
asta e comportament accesibil corect, nu un defect.

Pentru fiecare element atins, am verificat și dacă are un indicator de focus
vizibil (`:focus-visible` sau `outline` calculat, nu doar `outline: none`).

Verificări suplimentare:
- linkul "Sari la conținut" e prima oprire de tab pe pagina principală și
  țintește `#main`;
- formularul de căutare se poate completa și trimite integral din tastatură
  (`Tab` până la câmp, scriere, `Enter`), fără mouse;
- lista de județe/sectoare (`<details>`) se poate deschide cu `Enter` pe
  `<summary>` focusat, iar link-urile din interior devin focusabile după aceea.

## Rezultate

| Pagină | Elemente focusabile | Toate atinse via Tab | Focus vizibil peste tot |
|---|---|---|---|
| `/` | 7 | ✅ | ✅ |
| `/teritorii` | 59 (+ `<summary>`, nu era în selector) | ✅ | ✅ |
| `/teritorii?limit=5` | 59 | ✅ | ✅ |
| `/teritorii/{id}` | 11 | ✅ | ✅ |
| `/date` | 16 | ✅ | ✅ |
| 404 | 5 | ✅ | ✅ |

Skip link: ✅ prima oprire de tab, țintește `#main`.
Căutare doar din tastatură: ✅ `Enter` pe câmp trimite formularul corect
(`GET /teritorii?q=...`).
`<details>` județe: ✅ se deschide cu `Enter` pe `<summary>`, conținutul devine
focusabil imediat după.

**Zero eșecuri reale.** Prima rulare a scriptului de verificare a raportat 4
eșecuri, dar toate s-au dovedit artefacte ale scriptului însuși, nu probleme
reale ale site-ului:
- deduplicarea elementelor vizitate după text a coliziona pentru cele două
  linkuri identice "Registru" (navigare + breadcrumb) — fixat prin identitate
  DOM;
- linkurile din `<details>` colaps au fost numărate greșit ca "așteptate" să
  fie focusabile, deși browserul le exclude corect din ordinea de tab cât timp
  widget-ul e închis — fixat prin excluderea lor din setul așteptat;
- verificarea trimiterii formularului a citit URL-ul înainte ca navigarea să
  se termine (race condition în test, nu în site) — fixat cu
  `page.waitForURL(...)`.

## Reproducere

```
npm run build
npm run start -- -p 3100
# scriptul e ad-hoc (Playwright, nu parte din suita npm test), logica: pentru
# fiecare pagină, Tab repetat de la document.body, comparat cu elementele
# focusabile vizibile (excluzând <details> colaps), plus verificarea skip
# link-ului și a trimiterii formularului doar din tastatură.
```
