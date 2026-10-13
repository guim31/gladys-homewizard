// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, the reports of the Configuration actions, the errors of
// the commands. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noDevice: {
    en: 'No HomeWizard device found. Check that it is on the same network as Gladys, or enter its IP address.',
    fr: "Aucun appareil HomeWizard trouvé. Vérifiez qu'il est sur le même réseau que Gladys, ou saisissez son adresse IP.",
    de: 'Kein HomeWizard-Gerät gefunden. Prüfe, ob es im selben Netzwerk wie Gladys ist, oder gib seine IP-Adresse ein.',
    es: 'No se ha encontrado ningún dispositivo HomeWizard. Compruebe que está en la misma red que Gladys o introduzca su dirección IP.',
  },
  noAnswer: {
    en: 'No HomeWizard device answers.',
    fr: 'Aucun appareil HomeWizard ne répond.',
    de: 'Kein HomeWizard-Gerät antwortet.',
    es: 'Ningún dispositivo HomeWizard responde.',
  },
  needsAction: {
    en: 'HomeWizard devices found, but none can be read: turn on their local API in the HomeWizard Energy app, or pair them (Pair action).',
    fr: "Appareils HomeWizard trouvés, mais aucun n'est lisible : activez leur API locale dans l'application HomeWizard Energy, ou jumelez-les (action Jumeler).",
    de: 'HomeWizard-Geräte gefunden, aber keines ist lesbar: Aktiviere ihre lokale API in der HomeWizard-Energy-App oder kopple sie (Aktion Koppeln).',
    es: 'Se han encontrado dispositivos HomeWizard, pero ninguno se puede leer: active su API local en la aplicación HomeWizard Energy o vincúlelos (acción Vincular).',
  },
};

const MAX_LISTED = 8;

// The pieces of the "Search" report, one table per language.
export const SEARCH_TEXT = {
  en: {
    none: 'No HomeWizard device found.',
    count: (total, reachable) => `${total} device(s), ${reachable} read:`,
    unreachable: 'not answering',
    disabled: 'local API off in the app',
    pairing: 'press its button after "Pair"',
    unauthorized: 'token refused, pair it again',
    tls: 'certificate refused',
    unidentified: (list) => `To pair or enable: ${list}.`,
    unavailable:
      'Automatic discovery through Gladys is unavailable (Gladys 5.1 or later needed): enter the IP addresses.',
    busy: 'A search has just run: automatic discovery is available again in 10 seconds.',
    ignored: (list) => `Ignored addresses: ${list}.`,
  },
  fr: {
    none: 'Aucun appareil HomeWizard trouvé.',
    count: (total, reachable) => `${total} appareil(s), ${reachable} lu(s) :`,
    unreachable: 'ne répond pas',
    disabled: "API locale désactivée dans l'application",
    pairing: 'appuyez sur son bouton après « Jumeler »',
    unauthorized: 'jeton refusé, jumelez-le à nouveau',
    tls: 'certificat refusé',
    unidentified: (list) => `À jumeler ou activer : ${list}.`,
    unavailable:
      'La découverte automatique par Gladys est indisponible (Gladys 5.1 ou plus récent) : saisissez les adresses IP.',
    busy: 'Une recherche vient de tourner : la découverte automatique est de nouveau possible dans 10 secondes.',
    ignored: (list) => `Adresses ignorées : ${list}.`,
  },
  de: {
    none: 'Kein HomeWizard-Gerät gefunden.',
    count: (total, reachable) => `${total} Gerät(e), davon ${reachable} gelesen:`,
    unreachable: 'antwortet nicht',
    disabled: 'lokale API in der App aus',
    pairing: 'drück nach „Koppeln“ seine Taste',
    unauthorized: 'Token abgelehnt, kopple es neu',
    tls: 'Zertifikat abgelehnt',
    unidentified: (list) => `Zu koppeln oder zu aktivieren: ${list}.`,
    unavailable:
      'Die automatische Erkennung über Gladys ist nicht verfügbar (Gladys 5.1 oder neuer nötig): Gib die IP-Adressen ein.',
    busy: 'Gerade lief eine Suche: Die automatische Erkennung ist in 10 Sekunden wieder möglich.',
    ignored: (list) => `Ignorierte Adressen: ${list}.`,
  },
  es: {
    none: 'No se ha encontrado ningún dispositivo HomeWizard.',
    count: (total, reachable) => `${total} dispositivo(s), ${reachable} leído(s):`,
    unreachable: 'no responde',
    disabled: 'API local desactivada en la aplicación',
    pairing: 'pulse su botón después de «Vincular»',
    unauthorized: 'token rechazado, vincúlelo de nuevo',
    tls: 'certificado rechazado',
    unidentified: (list) => `Por vincular o activar: ${list}.`,
    unavailable:
      'El descubrimiento automático a través de Gladys no está disponible (se necesita Gladys 5.1 o posterior): introduzca las direcciones IP.',
    busy: 'Se acaba de realizar una búsqueda: el descubrimiento automático vuelve a estar disponible en 10 segundos.',
    ignored: (list) => `Direcciones ignoradas: ${list}.`,
  },
};

/** The report shown under the "Search" button, in every language. */
export function searchMessage(summary) {
  return perLanguage(SEARCH_TEXT, (text) => searchReport(summary, text));
}

function searchReport({ devices, unidentified, scan, invalidHosts }, text) {
  const lines = [];
  if (devices.length === 0 && unidentified.length === 0) {
    lines.push(text.none);
  }
  if (devices.length > 0) {
    const reachable = devices.filter((device) => device.reachable).length;
    lines.push(text.count(devices.length, reachable));
    // The first ones: the message stays readable under the button.
    const list = devices
      .slice(0, MAX_LISTED)
      .map(({ name, address, api, reachable: up, problem }) => {
        const notes = [address, api];
        if (problem) {
          notes.push(text[problem]);
        } else if (!up) {
          notes.push(text.unreachable);
        }
        return `${name} (${notes.filter(Boolean).join(', ')})`;
      });
    lines.push(`${list.join(', ')}${devices.length > MAX_LISTED ? '…' : '.'}`);
  }
  if (unidentified.length > 0) {
    lines.push(
      text.unidentified(
        unidentified
          .slice(0, MAX_LISTED)
          .map(({ address, problem }) => `${address} (${text[problem] ?? text.unreachable})`)
          .join(', '),
      ),
    );
  }
  if (scan === 'unavailable') {
    lines.push(text.unavailable);
  } else if (scan === 'busy') {
    lines.push(text.busy);
  }
  if (invalidHosts.length > 0) {
    lines.push(text.ignored(invalidHosts.slice(0, 3).join(', ')));
  }
  return lines.join(' ');
}

// The report of the "Pair" action (local API v2).
export const PAIR_TEXT = {
  en: {
    nothing:
      'No device to pair: every HomeWizard device found already has a token, or none offers the local API v2. Run a search first.',
    paired: (list) => `Paired: ${list}.`,
    missed: (list) => `No button pressed on: ${list}. Press it, then run Pair again.`,
  },
  fr: {
    nothing:
      "Aucun appareil à jumeler : chaque appareil HomeWizard trouvé a déjà son jeton, ou aucun ne propose l'API locale v2. Lancez d'abord une recherche.",
    paired: (list) => `Jumelé(s) : ${list}.`,
    missed: (list) =>
      `Aucun appui sur le bouton de : ${list}. Appuyez dessus, puis relancez Jumeler.`,
  },
  de: {
    nothing:
      'Kein Gerät zum Koppeln: Jedes gefundene HomeWizard-Gerät hat schon ein Token, oder keines bietet die lokale API v2. Starte zuerst eine Suche.',
    paired: (list) => `Gekoppelt: ${list}.`,
    missed: (list) => `Keine Taste gedrückt bei: ${list}. Drück sie und starte Koppeln erneut.`,
  },
  es: {
    nothing:
      'Ningún dispositivo por vincular: cada dispositivo HomeWizard encontrado ya tiene su token, o ninguno ofrece la API local v2. Inicie primero una búsqueda.',
    paired: (list) => `Vinculado(s): ${list}.`,
    missed: (list) => `No se ha pulsado el botón de: ${list}. Púlselo y vuelva a iniciar Vincular.`,
  },
};

/** The report shown under the "Pair" button, in every language. */
export function pairMessage({ paired, missed }) {
  return perLanguage(PAIR_TEXT, (text) => {
    if (paired.length === 0 && missed.length === 0) {
      return text.nothing;
    }
    const lines = [];
    if (paired.length > 0) {
      lines.push(text.paired(paired.slice(0, MAX_LISTED).join(', ')));
    }
    if (missed.length > 0) {
      lines.push(text.missed(missed.slice(0, MAX_LISTED).join(', ')));
    }
    return lines.join(' ');
  });
}

// Results and errors of the commands (Configuration action, scene actions,
// device features): the scene actions get no language, the configuration
// gives it.
export const ACTION_TEXT = {
  identified: {
    en: 'Look at the device: its status light is blinking.',
    fr: "Regardez l'appareil : son voyant clignote.",
    de: 'Schau auf das Gerät: Seine Statusleuchte blinkt.',
    es: 'Mire el dispositivo: su luz de estado parpadea.',
  },
  cannotIdentify: {
    en: 'This HomeWizard device cannot blink its light through the local API.',
    fr: 'Cet appareil HomeWizard ne peut pas faire clignoter son voyant par l’API locale.',
    de: 'Dieses HomeWizard-Gerät kann seine Leuchte nicht über die lokale API blinken lassen.',
    es: 'Este dispositivo HomeWizard no puede hacer parpadear su luz mediante la API local.',
  },
  unknownDevice: {
    en: 'Unknown HomeWizard device: run a search in the integration.',
    fr: "Appareil HomeWizard inconnu : lancez une recherche dans l'intégration.",
    de: 'Unbekanntes HomeWizard-Gerät: Starte eine Suche in der Integration.',
    es: 'Dispositivo HomeWizard desconocido: inicie una búsqueda en la integración.',
  },
  notSocket: {
    en: 'This device is not a HomeWizard Energy Socket.',
    fr: "Cet appareil n'est pas une prise HomeWizard Energy Socket.",
    de: 'Dieses Gerät ist keine HomeWizard Energy Socket.',
    es: 'Este dispositivo no es un enchufe HomeWizard Energy Socket.',
  },
  locked: {
    en: 'The switch lock of this socket is on: turn it off first.',
    fr: 'Le verrouillage du bouton de cette prise est actif : désactivez-le d’abord.',
    de: 'Die Tastensperre dieser Steckdose ist aktiv: Schalte sie zuerst aus.',
    es: 'El bloqueo del botón de este enchufe está activo: desactívelo primero.',
  },
  unreadable: {
    en: 'This device cannot be read: turn on its local API in the HomeWizard Energy app, or pair it.',
    fr: "Cet appareil n'est pas lisible : activez son API locale dans l'application HomeWizard Energy, ou jumelez-le.",
    de: 'Dieses Gerät ist nicht lesbar: Aktiviere seine lokale API in der HomeWizard-Energy-App oder kopple es.',
    es: 'Este dispositivo no se puede leer: active su API local en la aplicación HomeWizard Energy o vincúlelo.',
  },
  unreachable: {
    en: 'The HomeWizard device does not answer.',
    fr: "L'appareil HomeWizard ne répond pas.",
    de: 'Das HomeWizard-Gerät antwortet nicht.',
    es: 'El dispositivo HomeWizard no responde.',
  },
  readOnly: {
    en: 'This feature is read-only.',
    fr: 'Cette fonctionnalité est en lecture seule.',
    de: 'Diese Funktion ist schreibgeschützt.',
    es: 'Esta función es de solo lectura.',
  },
};

/** An error whose message is in the configured language (scene actions, commands). */
export function localError(key, language, cause) {
  const text = ACTION_TEXT[key];
  const error = new Error(text[language] ?? text.en, cause ? { cause } : undefined);
  error.code = key;
  return error;
}

function perLanguage(table, build) {
  return Object.fromEntries(
    Object.entries(table).map(([language, text]) => [language, build(text)]),
  );
}
