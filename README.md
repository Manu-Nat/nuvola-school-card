# Nuvola Scuola Card

Card per la dashboard di Home Assistant che mostra in un unico pannello i dati degli studenti
dell'integrazione [Nuvola Madisoft](https://github.com/Manu-Nat/ha-nuvola-madisoft): voti, compiti,
assenze, avvisi e pagamenti.

> Progetto indipendente, non affiliato a Madisoft. Richiede l'integrazione **Nuvola Madisoft** già
> installata e configurata.

## Funzioni

- Un pannello per ogni studente, affiancati o uno sotto l'altro (si sceglie quanti per riga).
- Anello con la media, ultimo voto, compiti di oggi, pagamenti da effettuare.
- Riquadri per assenze, non giustificate, ritardi, uscite, note e notifiche, con i colori di stato.
- Pillole di stato accanto al nome ("Tutto in regola", "€ 12,50 da pagare", ...).
- Elenco compiti per giorno, avvisi ed eventi (si aprono con un tocco), medie per materia.
- **Foto dello studente**, regolabile trascinandola nell'editor per centrare il viso, con zoom.
- Editor grafico completo; i testi e i riquadri si adattano alla grandezza del pannello.
- Segue i colori del tema in uso.

## Installazione

### Con HACS

1. HACS → menu a tre puntini → **Repository personalizzati**.
2. Aggiungi `https://github.com/Manu-Nat/nuvola-school-card` con categoria **Dashboard**.
3. Scarica **Nuvola Scuola Card** e ricarica il browser (Ctrl+F5).

HACS aggiunge da solo la risorsa. Se non compare, aggiungila a mano in
**Impostazioni → Dashboard → ⋮ → Risorse**: `/hacsfiles/nuvola-school-card/nuvola-school-card.js`,
tipo **Modulo JavaScript**.

### Manuale

1. Copia `nuvola-school-card.js` in `/config/www/`.
2. Aggiungi la risorsa `/local/nuvola-school-card.js` (tipo **Modulo JavaScript**).
3. Ricarica il browser con Ctrl+F5.

## Uso

Dall'editor delle dashboard scegli **Nuvola Scuola**. Senza nessuna impostazione la card trova da
sola tutti gli studenti dell'integrazione. In YAML basta:

```yaml
type: custom:nuvola-school-card
```

Esempio completo:

```yaml
type: custom:nuvola-school-card
title: Scuola
columns: 2
avatar_size: 6
avatar_shape: circle      # circle | rounded | square
header_align: left        # left | center
max_width: 0              # px, 0 = tutta la larghezza
show_homework: true
show_events: true
show_subjects: true
show_payments: true
homework_limit: 8
events_limit: 4
students:
  - device_id: IDENTIFICATIVO_DISPOSITIVO
    name: Nome
    color: "#4f8cff"
    photo: /local/foto.jpg
    photo_zoom: 1.4
    photo_x: -6
    photo_y: 8
  - device_id: IDENTIFICATIVO_DISPOSITIVO
    photo_entity: person.nome
```

### Opzioni

| Opzione | Predefinito | Descrizione |
|---|---|---|
| `title` | `Scuola` | Titolo in alto |
| `columns` | `0` | Studenti per riga (0 = automatico) |
| `avatar_size` | `4.6` | Dimensione dell'avatar |
| `avatar_shape` | `circle` | Forma dell'avatar |
| `header_align` | `left` | Allineamento dell'intestazione |
| `max_width` | `0` | Larghezza massima del contenuto in px |
| `show_homework`, `show_events`, `show_subjects`, `show_payments` | `true` | Mostra o nasconde i pannelli |
| `homework_limit`, `events_limit` | `8`, `4` | Quanti compiti/avvisi elencare |
| `students` | automatico | Elenco studenti (vedi sotto) |

Per ogni studente: `device_id` (dispositivo Nuvola), `name`, `color`, `photo` (indirizzo, per esempio
`/local/foto.jpg`), `photo_entity` (entità `person` o `image`), `photo_zoom` (1–4), `photo_x` e
`photo_y` (-100–100, spostamento in %). Con `prefix` (per esempio `nome_bambino`) puoi invece
indicare il prefisso delle entità al posto del dispositivo.

La foto si centra comodamente dall'editor grafico: trascinala nell'anteprima fino a mettere il viso
al centro della croce.

## Note

- Le entità vengono riconosciute dal nome (`..._assenze`, `..._media`, `..._pagamenti`, ...): se le
  hai rinominate o Home Assistant era in un'altra lingua quando sono state create, usa `prefix` o
  rinominale.
- Le foto sono dati personali di minorenni: tienile in `/config/www/` o usa un'entità `person`,
  non pubblicarle in repository o screenshot pubblici.
