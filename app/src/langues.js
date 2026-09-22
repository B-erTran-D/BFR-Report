/* =========================================================================
   langues.js — Traduction du rapport dans la langue du client
   -------------------------------------------------------------------------
   Deux mécanismes complémentaires :

   1. PACKS DE LANGUE (ce fichier) : tous les libellés fixes du rapport
      (titres, tableaux, mentions, pied de page…) sont traduits par un
      dictionnaire embarqué. Cela fonctionne HORS CONNEXION, sans rien
      installer, et c'est identique dans le PDF, l'aperçu et le Word.

   2. TRADUCTION AUTOMATIQUE (traduction.js) : les textes SAISIS par le
      technicien (objet, actions, observations, synthèse) sont traduits par
      le traducteur du téléphone (Chrome, gratuit, hors connexion une fois
      la langue téléchargée).

   Rien ici ne modifie le rapport français : la génération en français reste
   la référence, la version traduite est produite à côté.
   ========================================================================= */
(function (global) {
  'use strict';

  /* --- Langues proposées (ordre d'affichage) --------------------------- */
  /* Toutes compatibles avec le moteur PDF de l'application (police latine
     standard : accents d'Europe de l'Ouest). */
  const LANGUES = [
    { code: 'en', nom: 'Anglais', natif: 'English' },
    { code: 'de', nom: 'Allemand', natif: 'Deutsch' },
    { code: 'nl', nom: 'Néerlandais', natif: 'Nederlands' },
    { code: 'es', nom: 'Espagnol', natif: 'Español' },
    { code: 'it', nom: 'Italien', natif: 'Italiano' },
    { code: 'pt', nom: 'Portugais', natif: 'Português' }
  ];

  /* --- Dictionnaire : libellé français -> traductions ------------------- */
  /* La clé est le texte exact écrit par le générateur de rapport. */
  const DICO = {
    /* Titres et blocs du modèle */
    "Compte rendu d'intervention": {
      en: 'Service report', de: 'Servicebericht', nl: 'Serviceverslag',
      es: 'Informe de intervención', it: 'Rapporto di intervento', pt: 'Relatório de intervenção'
    },
    'Votre contact :': {
      en: 'Your contact:', de: 'Ihr Ansprechpartner:', nl: 'Uw contactpersoon:',
      es: 'Su contacto:', it: 'Il suo referente:', pt: 'O seu contacto:'
    },
    'Intervention': {
      en: 'Service call', de: 'Einsatz', nl: 'Interventie',
      es: 'Intervención', it: 'Intervento', pt: 'Intervenção'
    },

    /* Tableau d'identification */
    'Machine / équipement': {
      en: 'Machine / equipment', de: 'Maschine / Anlage', nl: 'Machine / installatie',
      es: 'Máquina / equipo', it: 'Macchina / impianto', pt: 'Máquina / equipamento'
    },
    'Modèle': { en: 'Model', de: 'Modell', nl: 'Model', es: 'Modelo', it: 'Modello', pt: 'Modelo' },
    'N° de série': {
      en: 'Serial number', de: 'Seriennummer', nl: 'Serienummer',
      es: 'N.º de serie', it: 'Numero di serie', pt: 'N.º de série'
    },
    'Compteur': { en: 'Counter', de: 'Zähler', nl: 'Teller', es: 'Contador', it: 'Contatore', pt: 'Contador' },
    'Compteur / N° de parc': {
      en: 'Counter / asset no.', de: 'Zähler / Anlagennr.', nl: 'Teller / activanr.',
      es: 'Contador / n.º de activo', it: 'Contatore / n. impianto', pt: 'Contador / n.º de ativo'
    },
    'Objet / demande': {
      en: 'Subject / request', de: 'Betreff / Anfrage', nl: 'Onderwerp / aanvraag',
      es: 'Asunto / solicitud', it: 'Oggetto / richiesta', pt: 'Assunto / pedido'
    },
    'Objet / demande du client': {
      en: "Customer's subject / request", de: 'Betreff / Anfrage des Kunden', nl: 'Onderwerp / aanvraag van de klant',
      es: 'Asunto / solicitud del cliente', it: 'Oggetto / richiesta del cliente', pt: 'Assunto / pedido do cliente'
    },
    'Lieu': { en: 'Location', de: 'Standort', nl: 'Locatie', es: 'Ubicación', it: 'Luogo', pt: 'Local' },
    'Contact sur site': {
      en: 'On-site contact', de: 'Ansprechpartner vor Ort', nl: 'Contact ter plaatse',
      es: 'Contacto en planta', it: 'Referente in loco', pt: 'Contacto no local'
    },
    'Téléphone / e-mail': {
      en: 'Phone / e-mail', de: 'Telefon / E-Mail', nl: 'Telefoon / e-mail',
      es: 'Teléfono / correo', it: 'Telefono / e-mail', pt: 'Telefone / e-mail'
    },
    'Téléphone / e-mail client': {
      en: 'Customer phone / e-mail', de: 'Telefon / E-Mail Kunde', nl: 'Telefoon / e-mail klant',
      es: 'Teléfono / correo del cliente', it: 'Telefono / e-mail cliente', pt: 'Telefone / e-mail do cliente'
    },
    "Date d'intervention": {
      en: 'Service date', de: 'Einsatzdatum', nl: 'Datum interventie',
      es: 'Fecha de intervención', it: "Data dell'intervento", pt: 'Data da intervenção'
    },
    'Horaires sur site': {
      en: 'On-site times', de: 'Zeiten vor Ort', nl: 'Tijden ter plaatse',
      es: 'Horario en planta', it: 'Orari in loco', pt: 'Horário no local'
    },
    'Durée sur site': {
      en: 'Time on site', de: 'Zeit vor Ort', nl: 'Tijd ter plaatse',
      es: 'Duración en planta', it: 'Durata in loco', pt: 'Duração no local'
    },
    'Heures passées sur site': {
      en: 'Hours spent on site', de: 'Vor Ort verbrachte Stunden', nl: 'Uren ter plaatse',
      es: 'Horas en planta', it: 'Ore passate in loco', pt: 'Horas no local'
    },
    'Technicien': { en: 'Technician', de: 'Techniker', nl: 'Technicus', es: 'Técnico', it: 'Tecnico', pt: 'Técnico' },
    'Client': { en: 'Customer', de: 'Kunde', nl: 'Klant', es: 'Cliente', it: 'Cliente', pt: 'Cliente' },
    'Machine': { en: 'Machine', de: 'Maschine', nl: 'Machine', es: 'Máquina', it: 'Macchina', pt: 'Máquina' },
    'Adresse client': {
      en: 'Customer address', de: 'Kundenadresse', nl: 'Klantadres',
      es: 'Dirección del cliente', it: 'Indirizzo cliente', pt: 'Endereço do cliente'
    },

    /* Sections du canevas */
    'Synthèse': { en: 'Summary', de: 'Zusammenfassung', nl: 'Samenvatting', es: 'Resumen', it: 'Sintesi', pt: 'Resumo' },
    'Synthèse du technicien': {
      en: "Technician's summary", de: 'Zusammenfassung des Technikers', nl: 'Samenvatting van de technicus',
      es: 'Resumen del técnico', it: 'Sintesi del tecnico', pt: 'Resumo do técnico'
    },
    'Évènements': { en: 'Events', de: 'Ereignisse', nl: 'Gebeurtenissen', es: 'Eventos', it: 'Eventi', pt: 'Eventos' },
    'Événements': { en: 'Events', de: 'Ereignisse', nl: 'Gebeurtenissen', es: 'Eventos', it: 'Eventi', pt: 'Eventos' },
    'Texte': { en: 'Text', de: 'Text', nl: 'Tekst', es: 'Texto', it: 'Testo', pt: 'Texto' },
    'Photos': { en: 'Photos', de: 'Fotos', nl: "Foto's", es: 'Fotos', it: 'Foto', pt: 'Fotos' },
    'Validation': { en: 'Validation', de: 'Bestätigung', nl: 'Validatie', es: 'Validación', it: 'Convalida', pt: 'Validação' },
    'Catégorie': { en: 'Category', de: 'Kategorie', nl: 'Categorie', es: 'Categoría', it: 'Categoria', pt: 'Categoria' },
    'Nombre': { en: 'Number', de: 'Anzahl', nl: 'Aantal', es: 'Número', it: 'Numero', pt: 'Número' },
    'Photos jointes': {
      en: 'Attached photos', de: 'Beigefügte Fotos', nl: "Bijgevoegde foto's",
      es: 'Fotos adjuntas', it: 'Foto allegate', pt: 'Fotos anexadas'
    },
    'Points de sécurité / urgence': {
      en: 'Safety / urgent points', de: 'Sicherheits- / Notfallpunkte', nl: 'Veiligheids- / urgentiepunten',
      es: 'Puntos de seguridad / urgencia', it: 'Punti di sicurezza / urgenza', pt: 'Pontos de segurança / urgência'
    },

    /* Titres de sections du canevas standard (numérotés) */
    "1. Synthèse de l'intervention": {
      en: '1. Summary of the service call', de: '1. Zusammenfassung des Einsatzes', nl: '1. Samenvatting van de interventie',
      es: '1. Resumen de la intervención', it: "1. Sintesi dell'intervento", pt: '1. Resumo da intervenção'
    },
    '2. Sécurité et urgences': {
      en: '2. Safety and emergencies', de: '2. Sicherheit und Notfälle', nl: '2. Veiligheid en urgenties',
      es: '2. Seguridad y urgencias', it: '2. Sicurezza e urgenze', pt: '2. Segurança e urgências'
    },
    '3. Points de priorité haute': {
      en: '3. High-priority points', de: '3. Punkte hoher Priorität', nl: '3. Punten met hoge prioriteit',
      es: '3. Puntos de prioridad alta', it: '3. Punti di priorità alta', pt: '3. Pontos de prioridade alta'
    },
    '4. Points de priorité basse': {
      en: '4. Low-priority points', de: '4. Punkte niedriger Priorität', nl: '4. Punten met lage prioriteit',
      es: '4. Puntos de prioridad baja', it: '4. Punti di priorità bassa', pt: '4. Pontos de prioridade baixa'
    },
    '5. Informations complémentaires': {
      en: '5. Additional information', de: '5. Zusätzliche Informationen', nl: '5. Aanvullende informatie',
      es: '5. Información adicional', it: '5. Informazioni aggiuntive', pt: '5. Informações complementares'
    },
    '6. Travaux réalisés': {
      en: '6. Work performed', de: '6. Durchgeführte Arbeiten', nl: '6. Uitgevoerde werkzaamheden',
      es: '6. Trabajos realizados', it: '6. Lavori eseguiti', pt: '6. Trabalhos realizados'
    },
    '7. Travaux à prévoir': {
      en: '7. Work to be planned', de: '7. Geplante Arbeiten', nl: '7. Gepland werk',
      es: '7. Trabajos a prever', it: '7. Lavori da prevedere', pt: '7. Trabalhos a prever'
    },
    '8. Photos complémentaires': {
      en: '8. Additional photos', de: '8. Zusätzliche Fotos', nl: "8. Aanvullende foto's",
      es: '8. Fotos complementarias', it: '8. Foto aggiuntive', pt: '8. Fotos complementares'
    },
    '9. Validation': {
      en: '9. Validation', de: '9. Bestätigung', nl: '9. Validatie',
      es: '9. Validación', it: '9. Convalida', pt: '9. Validação'
    },

    /* Domaines et catégories par défaut */
    'Mécanique': { en: 'Mechanical', de: 'Mechanik', nl: 'Mechanisch', es: 'Mecánica', it: 'Meccanica', pt: 'Mecânica' },
    'Électrique': { en: 'Electrical', de: 'Elektrik', nl: 'Elektrisch', es: 'Eléctrica', it: 'Elettrica', pt: 'Elétrica' },
    'Automatisme': {
      en: 'Automation', de: 'Automatisierung', nl: 'Automatisering',
      es: 'Automatización', it: 'Automazione', pt: 'Automação'
    },
    'Sécurité': { en: 'Safety', de: 'Sicherheit', nl: 'Veiligheid', es: 'Seguridad', it: 'Sicurezza', pt: 'Segurança' },
    'Problème de sécurité': {
      en: 'Safety issue', de: 'Sicherheitsproblem', nl: 'Veiligheidsprobleem',
      es: 'Problema de seguridad', it: 'Problema di sicurezza', pt: 'Problema de segurança'
    },
    'Priorité basse': {
      en: 'Low priority', de: 'Niedrige Priorität', nl: 'Lage prioriteit',
      es: 'Prioridad baja', it: 'Priorità bassa', pt: 'Prioridade baixa'
    },
    'Urgent': { en: 'Urgent', de: 'Dringend', nl: 'Urgent', es: 'Urgente', it: 'Urgente', pt: 'Urgente' },
    'Priorité haute': {
      en: 'High priority', de: 'Hohe Priorität', nl: 'Hoge prioriteit',
      es: 'Prioridad alta', it: 'Priorità alta', pt: 'Prioridade alta'
    },
    'Basse': { en: 'Low', de: 'Niedrig', nl: 'Laag', es: 'Baja', it: 'Bassa', pt: 'Baixa' },
    'Informatif': {
      en: 'Informational', de: 'Informativ', nl: 'Informatief',
      es: 'Informativo', it: 'Informativo', pt: 'Informativo'
    },

    /* Signatures et validation */
    'Le client (bon pour accord)': {
      en: 'The customer (approved)', de: 'Der Kunde (Genehmigung)', nl: 'De klant (voor akkoord)',
      es: 'El cliente (conforme)', it: 'Il cliente (per approvazione)', pt: 'O cliente (de acordo)'
    },
    'Le technicien': {
      en: 'The technician', de: 'Der Techniker', nl: 'De technicus',
      es: 'El técnico', it: 'Il tecnico', pt: 'O técnico'
    },
    'Signature non recueillie': {
      en: 'Signature not obtained', de: 'Unterschrift nicht erhalten', nl: 'Handtekening niet verkregen',
      es: 'Firma no recogida', it: 'Firma non raccolta', pt: 'Assinatura não recolhida'
    },
    'Le client reconnaît avoir pris connaissance du présent rapport, avoir reçu les explications du technicien et accepte les constats et travaux décrits.': {
      en: "The customer acknowledges having read this report, having received the technician's explanations, and accepts the findings and the work described.",
      de: 'Der Kunde bestätigt, diesen Bericht zur Kenntnis genommen, die Erläuterungen des Technikers erhalten zu haben und die beschriebenen Feststellungen und Arbeiten zu akzeptieren.',
      nl: 'De klant verklaart kennis te hebben genomen van dit verslag, de uitleg van de technicus te hebben ontvangen en de beschreven vaststellingen en werkzaamheden te aanvaarden.',
      es: 'El cliente reconoce haber leído el presente informe, haber recibido las explicaciones del técnico y acepta las observaciones y los trabajos descritos.',
      it: "Il cliente dichiara di aver preso visione del presente rapporto, di aver ricevuto le spiegazioni del tecnico e accetta le constatazioni e i lavori descritti.",
      pt: 'O cliente reconhece ter tomado conhecimento do presente relatório, ter recebido as explicações do técnico e aceita os factos e os trabalhos descritos.'
    },
    'Le client reconnaît avoir pris connaissance du présent rapport et accepte les constats et travaux décrits.': {
      en: 'The customer acknowledges having read this report and accepts the findings and the work described.',
      de: 'Der Kunde bestätigt, diesen Bericht zur Kenntnis genommen zu haben, und akzeptiert die beschriebenen Feststellungen und Arbeiten.',
      nl: 'De klant verklaart kennis te hebben genomen van dit verslag en de beschreven vaststellingen en werkzaamheden te aanvaarden.',
      es: 'El cliente reconoce haber leído el presente informe y acepta las observaciones y los trabajos descritos.',
      it: 'Il cliente dichiara di aver preso visione del presente rapporto e accetta le constatazioni e i lavori descritti.',
      pt: 'O cliente reconhece ter tomado conhecimento do presente relatório e aceita os factos e os trabalhos descritos.'
    },

    /* Divers */
    'en cours': { en: 'in progress', de: 'läuft noch', nl: 'loopt nog', es: 'en curso', it: 'in corso', pt: 'em curso' },
    '(aucune annotation)': {
      en: '(no comment)', de: '(keine Anmerkung)', nl: '(geen opmerking)',
      es: '(sin anotación)', it: '(nessuna annotazione)', pt: '(sem anotação)'
    },
    'Aucun point de sécurité ou d\'urgence relevé.': {
      en: 'No safety or urgent point reported.', de: 'Keine Sicherheits- oder Notfallpunkte gemeldet.',
      nl: 'Geen veiligheids- of urgentiepunten gemeld.', es: 'No se ha detectado ningún punto de seguridad o urgencia.',
      it: "Nessun punto di sicurezza o urgenza rilevato.", pt: 'Nenhum ponto de segurança ou urgência detetado.'
    },
    "Siège social et site de production n°1": {
      en: 'Head office and production site no. 1', de: 'Firmensitz und Produktionsstätte Nr. 1',
      nl: 'Hoofdzetel en productiesite nr. 1', es: 'Sede social y planta de producción n.º 1',
      it: 'Sede legale e stabilimento n. 1', pt: 'Sede social e unidade de produção n.º 1'
    },
    'Site de production n°2': {
      en: 'Production site no. 2', de: 'Produktionsstätte Nr. 2', nl: 'Productiesite nr. 2',
      es: 'Planta de producción n.º 2', it: 'Stabilimento n. 2', pt: 'Unidade de produção n.º 2'
    },
    'Siège social et site de production n°1 – 1, rue du Jariel, ZAC Les Longs Sillons, 77120 Coulommiers, France': {
      en: 'Head office and production site no. 1 – 1, rue du Jariel, ZAC Les Longs Sillons, 77120 Coulommiers, France',
      de: 'Firmensitz und Produktionsstätte Nr. 1 – 1, rue du Jariel, ZAC Les Longs Sillons, 77120 Coulommiers, Frankreich',
      nl: 'Hoofdzetel en productiesite nr. 1 – 1, rue du Jariel, ZAC Les Longs Sillons, 77120 Coulommiers, Frankrijk',
      es: 'Sede social y planta de producción n.º 1 – 1, rue du Jariel, ZAC Les Longs Sillons, 77120 Coulommiers, Francia',
      it: 'Sede legale e stabilimento n. 1 – 1, rue du Jariel, ZAC Les Longs Sillons, 77120 Coulommiers, Francia',
      pt: 'Sede social e unidade de produção n.º 1 – 1, rue du Jariel, ZAC Les Longs Sillons, 77120 Coulommiers, França'
    },
    'Site de production n°2 – 50 allée des érables, 01150 Blyes, France': {
      en: 'Production site no. 2 – 50 allée des érables, 01150 Blyes, France',
      de: 'Produktionsstätte Nr. 2 – 50 allée des érables, 01150 Blyes, Frankreich',
      nl: 'Productiesite nr. 2 – 50 allée des érables, 01150 Blyes, Frankrijk',
      es: 'Planta de producción n.º 2 – 50 allée des érables, 01150 Blyes, Francia',
      it: 'Stabilimento n. 2 – 50 allée des érables, 01150 Blyes, Francia',
      pt: 'Unidade de produção n.º 2 – 50 allée des érables, 01150 Blyes, França'
    },
    'Rapport': {
      en: 'Report', de: 'Bericht', nl: 'Verslag', es: 'Informe', it: 'Rapporto', pt: 'Relatório'
    }
  };

  /* --- Libellés qui peuvent être traduits en début de chaîne ------------ */
  /* (« Mécanique : 3 », « Sécurité : 1 »). On ne touche jamais au reste :
     un texte saisi par le technicien n'est pas modifié par le dictionnaire. */
  const PREFIXABLES = [
    'mécanique', 'électrique', 'automatisme', 'sécurité', 'urgent', 'priorité haute',
    'basse', 'informatif', 'catégorie', 'nombre', 'photos', 'date', 'client', 'technicien',
    'machine', 'modèle', 'lieu', 'intervention'
  ];

  /* --- Règles de traduction des libellés composés ----------------------- */
  /* [motif, remplacement] — appliquées dans l'ordre. */
  const REGLES = {
    en: [
      [/^N° (.*)$/, 'No. $1'],
      [/^Tél\. (.*)$/, 'Tel. $1'],
      [/^Date : (.*) à (.*)$/, 'Date: $1 at $2'],
      [/^Date : (.*)$/, 'Date: $1'],
      [/^Édité le (.*)$/, 'Generated on $1'],
      [/^Page (\d+) \/ (\d+)$/, 'Page $1 / $2'],
      [/^(\d+) év[èé]nement\(s\)$/, '$1 event(s)'],
      [/^(\d+) photo\(s\)$/, '$1 photo(s)'],
      [/^Photo (\d+)$/, 'Photo $1'],
      [/^À l'attention de (.*),$/, 'For the attention of $1,'],
      [/^À (.+), le (.+),$/, 'In $1, on $2,'],
      [/^Heures passées sur site : (.*)$/, 'Hours spent on site: $1'],
      [/^Photos : (.*)$/, 'Photos: $1'],
      [/^Siège social et site de production n°1 – (.*)$/, 'Head office and production site no. 1 – $1'],
      [/^Site de production n°2 – (.*)$/, 'Production site no. 2 – $1'],
      [/^Compte rendu d'intervention N° (.*)$/, 'Service report No. $1']
    ],
    de: [
      [/^N° (.*)$/, 'Nr. $1'],
      [/^Tél\. (.*)$/, 'Tel. $1'],
      [/^Date : (.*) à (.*)$/, 'Datum: $1 um $2'],
      [/^Date : (.*)$/, 'Datum: $1'],
      [/^Édité le (.*)$/, 'Erstellt am $1'],
      [/^Page (\d+) \/ (\d+)$/, 'Seite $1 / $2'],
      [/^(\d+) év[èé]nement\(s\)$/, '$1 Ereignis(se)'],
      [/^(\d+) photo\(s\)$/, '$1 Foto(s)'],
      [/^Photo (\d+)$/, 'Foto $1'],
      [/^À l'attention de (.*),$/, 'z. Hd. $1,'],
      [/^À (.+), le (.+),$/, '$1, den $2,'],
      [/^Heures passées sur site : (.*)$/, 'Vor Ort verbrachte Stunden: $1'],
      [/^Photos : (.*)$/, 'Fotos: $1'],
      [/^Compte rendu d'intervention N° (.*)$/, 'Servicebericht Nr. $1']
    ],
    nl: [
      [/^N° (.*)$/, 'Nr. $1'],
      [/^Tél\. (.*)$/, 'Tel. $1'],
      [/^Date : (.*) à (.*)$/, 'Datum: $1 om $2'],
      [/^Date : (.*)$/, 'Datum: $1'],
      [/^Édité le (.*)$/, 'Aangemaakt op $1'],
      [/^Page (\d+) \/ (\d+)$/, 'Pagina $1 / $2'],
      [/^(\d+) év[èé]nement\(s\)$/, '$1 gebeurtenis(sen)'],
      [/^(\d+) photo\(s\)$/, "$1 foto('s)"],
      [/^Photo (\d+)$/, 'Foto $1'],
      [/^À l'attention de (.*),$/, 'Ter attentie van $1,'],
      [/^À (.+), le (.+),$/, '$1, $2,'],
      [/^Heures passées sur site : (.*)$/, 'Uren ter plaatse: $1'],
      [/^Photos : (.*)$/, "Foto's: $1"],
      [/^Compte rendu d'intervention N° (.*)$/, 'Serviceverslag nr. $1']
    ],
    es: [
      [/^N° (.*)$/, 'N.º $1'],
      [/^Tél\. (.*)$/, 'Tel. $1'],
      [/^Date : (.*) à (.*)$/, 'Fecha: $1 a las $2'],
      [/^Date : (.*)$/, 'Fecha: $1'],
      [/^Édité le (.*)$/, 'Emitido el $1'],
      [/^Page (\d+) \/ (\d+)$/, 'Página $1 / $2'],
      [/^(\d+) év[èé]nement\(s\)$/, '$1 evento(s)'],
      [/^(\d+) photo\(s\)$/, '$1 foto(s)'],
      [/^Photo (\d+)$/, 'Foto $1'],
      [/^À l'attention de (.*),$/, 'A la atención de $1,'],
      [/^À (.+), le (.+),$/, 'En $1, a $2,'],
      [/^Heures passées sur site : (.*)$/, 'Horas en planta: $1'],
      [/^Photos : (.*)$/, 'Fotos: $1'],
      [/^Compte rendu d'intervention N° (.*)$/, 'Informe de intervención n.º $1']
    ],
    it: [
      [/^N° (.*)$/, 'N. $1'],
      [/^Tél\. (.*)$/, 'Tel. $1'],
      [/^Date : (.*) à (.*)$/, 'Data: $1 alle $2'],
      [/^Date : (.*)$/, 'Data: $1'],
      [/^Édité le (.*)$/, 'Creato il $1'],
      [/^Page (\d+) \/ (\d+)$/, 'Pagina $1 / $2'],
      [/^(\d+) év[èé]nement\(s\)$/, '$1 evento/i'],
      [/^(\d+) photo\(s\)$/, '$1 foto'],
      [/^Photo (\d+)$/, 'Foto $1'],
      [/^À l'attention de (.*),$/, "All'attenzione di $1,"],
      [/^À (.+), le (.+),$/, 'A $1, il $2,'],
      [/^Heures passées sur site : (.*)$/, 'Ore passate in loco: $1'],
      [/^Photos : (.*)$/, 'Foto: $1'],
      [/^Compte rendu d'intervention N° (.*)$/, 'Rapporto di intervento n. $1']
    ],
    pt: [
      [/^N° (.*)$/, 'N.º $1'],
      [/^Tél\. (.*)$/, 'Tel. $1'],
      [/^Date : (.*) à (.*)$/, 'Data: $1 às $2'],
      [/^Date : (.*)$/, 'Data: $1'],
      [/^Édité le (.*)$/, 'Emitido em $1'],
      [/^Page (\d+) \/ (\d+)$/, 'Página $1 / $2'],
      [/^(\d+) év[èé]nement\(s\)$/, '$1 evento(s)'],
      [/^(\d+) photo\(s\)$/, '$1 foto(s)'],
      [/^Photo (\d+)$/, 'Foto $1'],
      [/^À l'attention de (.*),$/, 'À atenção de $1,'],
      [/^À (.+), le (.+),$/, 'Em $1, a $2,'],
      [/^Heures passées sur site : (.*)$/, 'Horas no local: $1'],
      [/^Photos : (.*)$/, 'Fotos: $1'],
      [/^Compte rendu d'intervention N° (.*)$/, 'Relatório de intervenção n.º $1']
    ]
  };

  /* --- Phrase bilingue ajoutée au mail quand la traduction est active --- */
  const PHRASES = {
    en: 'Please find attached the service report in French and its English version.',
    de: 'Im Anhang finden Sie den Servicebericht auf Französisch und die deutsche Fassung.',
    nl: 'In bijlage vindt u het serviceverslag in het Frans en de Nederlandse versie.',
    es: 'Adjunto encontrará el informe de intervención en francés y su versión en español.',
    it: 'In allegato il rapporto di intervento in francese e la versione in italiano.',
    pt: 'Em anexo o relatório de intervenção em francês e a respetiva versão em português.'
  };

  /* ===================== Moteur de traduction ========================== */
  function normaliser(txt) {
    return String(txt == null ? '' : txt)
      .replace(/[\u2018\u2019\u02BC]/g, "'")      // apostrophes typographiques
      .replace(/\u00A0|\u202F|\u2009/g, ' ')        // espaces insécables
      .replace(/\s+/g, ' ')
      .trim();
  }
  function cle(txt) {
    return normaliser(txt).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  /* Index du dictionnaire : clé normalisée -> entrée d'origine. */
  const INDEX = {};
  Object.keys(DICO).forEach(function (fr) { INDEX[cle(fr)] = fr; });
  /* Libellés traduisibles en début de chaîne : on retrouve l'entrée exacte du
     dictionnaire (« mecanique » -> « Mécanique »). */
  const INDEX_PREFIXES = {};
  PREFIXABLES.forEach(function (mot) {
    const ref = INDEX[cle(mot)];
    if (ref) INDEX_PREFIXES[cle(mot)] = ref;
  });

  function majusculesSiBesoin(origine, traduit) {
    const brut = normaliser(origine);
    /* « [INFORMATIF] », « SÉCURITÉ »… : on garde la casse du rapport. */
    const lettres = brut.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (lettres && lettres === lettres.toUpperCase()) return traduit.toUpperCase();
    return traduit;
  }

  const I18N = {
    langues: LANGUES,
    dico: DICO,

    /* Langue par son code, ou null. */
    langue: function (code) {
      return LANGUES.filter(function (l) { return l.code === code; })[0] || null;
    },
    nom: function (code) {
      const l = this.langue(code);
      return l ? l.nom : '';
    },
    natif: function (code) {
      const l = this.langue(code);
      return l ? l.natif : '';
    },
    /* « français + English », pour les libellés d'interface. */
    duo: function (code) {
      const l = this.langue(code);
      return l ? 'français + ' + l.natif : 'français';
    },

    /* Traduit un libellé du rapport. Renvoie le texte inchangé si :
       — la langue est le français, ou
       — le texte n'est pas un libellé connu (c'est une donnée du terrain). */
    traduire: function (txt, code) {
      if (!code || code === 'fr') return txt;
      const s = normaliser(txt);
      if (!s) return txt;

      /* 1. libellé exact */
      const ref = INDEX[cle(s)];
      if (ref) {
        const t = DICO[ref][code];
        if (t) return majusculesSiBesoin(txt, t);
      }

      /* 2. libellés composés (numéro, téléphone, date, page, destinataire…) */
      const regles = REGLES[code] || [];
      for (let k = 0; k < regles.length; k++) {
        if (regles[k][0].test(s)) return s.replace(regles[k][0], regles[k][1]);
      }

      /* 3. libellé en début de chaîne suivi d'un séparateur
            (« Mécanique : 3 », « Sécurité — … ») : seul le libellé est traduit. */
      const m = /^([^:—•]{2,40}?)\s*(: | — | • )/.exec(s);
      if (m && INDEX_PREFIXES[cle(m[1])]) {
        const t = DICO[INDEX_PREFIXES[cle(m[1])]][code];
        if (t) return t + s.slice(m[1].length);
      }

      return txt;
    },

    /* Vérifie que le pack de langue est complet pour toutes les entrées. */
    complet: function (code) {
      const manquants = [];
      Object.keys(DICO).forEach(function (fr) {
        if (!DICO[fr][code]) manquants.push(fr);
      });
      return manquants;
    },

    /* Phrase bilingue pour le mail (null si la langue n'en a pas). */
    phraseTraduction: function (code) {
      return PHRASES[code] || null;
    }
  };

  global.LANGUES_BFR = LANGUES;
  global.I18N = I18N;
})(window);
