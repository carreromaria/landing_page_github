// ============================================================
// LINENCE — Seguimiento de Proyectos
// Configuración de etapas y cálculo automático de porcentaje
// ============================================================
// En la Fase 5 esta lista se leerá desde Firestore (config/etapas).
// Por ahora vive aquí como fuente única de verdad para el maquetado.

export const ETAPAS = [
  { index: 0,  nombre: "Cotización aceptada",          porcentaje: 0   },
  { index: 1,  nombre: "Abono del 50%",                 porcentaje: 9   },
  { index: 2,  nombre: "Compra de materiales",           porcentaje: 18  },
  { index: 3,  nombre: "Corte de materiales",            porcentaje: 27  },
  { index: 4,  nombre: "Fabricación",                    porcentaje: 36  },
  { index: 5,  nombre: "Armado",                         porcentaje: 46  },
  { index: 6,  nombre: "Control de Calidad",             porcentaje: 55  },
  { index: 7,  nombre: "Embalaje",                       porcentaje: 64  },
  { index: 8,  nombre: "Coordinación de instalación",    porcentaje: 73  },
  { index: 9,  nombre: "Instalación",                    porcentaje: 91  },
  { index: 10, nombre: "Entrega del proyecto",           porcentaje: 100 }
];

/**
 * Calcula el porcentaje de avance real según la etapa actual y su estado.
 * Si la etapa está "en_proceso", se muestra el % de la etapa anterior
 * más la mitad del tramo hacia la etapa actual (avance visual, nunca
 * se ingresa a mano).
 */
export function calcularPorcentaje(etapaActualIndex, estadoEtapaActual) {
  const actual = ETAPAS[etapaActualIndex];
  const anterior = ETAPAS[etapaActualIndex - 1];

  if (!actual) return 0;
  if (estadoEtapaActual === "completada") return actual.porcentaje;

  if (estadoEtapaActual === "en_proceso" && anterior) {
    return Math.round(anterior.porcentaje + (actual.porcentaje - anterior.porcentaje) / 2);
  }

  return anterior ? anterior.porcentaje : 0;
}

export function nombreEtapa(index) {
  return ETAPAS[index]?.nombre ?? "";
}
