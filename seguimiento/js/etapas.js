// ============================================================
// LINENCE — Seguimiento de Proyectos
// Configuración de etapas y cálculo automático de porcentaje
// ============================================================
// En la Fase 5 esta lista se leerá desde Firestore (config/etapas).
// Por ahora vive aquí como fuente única de verdad para el maquetado.

export const ETAPAS = [
  { index: 0,  nombre: "Cotización aceptada",          porcentaje: 0   },
  { index: 1,  nombre: "Abono del 50%",                 porcentaje: 10  },
  { index: 2,  nombre: "Compra de materiales",           porcentaje: 20  },
  { index: 3,  nombre: "Corte de materiales",            porcentaje: 30  },
  { index: 4,  nombre: "Fabricación",                    porcentaje: 40  },
  { index: 5,  nombre: "Armado",                         porcentaje: 50  },
  { index: 6,  nombre: "Control de Calidad",             porcentaje: 60  },
  { index: 7,  nombre: "Embalaje",                       porcentaje: 70  },
  { index: 8,  nombre: "Coordinación de instalación",    porcentaje: 80  },
  { index: 9,  nombre: "Instalación",                    porcentaje: 90  },
  { index: 10, nombre: "Entrega del proyecto",           porcentaje: 100 }
];

/**
 * El porcentaje de avance corresponde directamente al de la etapa
 * actual (sin importar si está pendiente, en proceso o completada).
 * Es una tabla fija: cada etapa "vale" su propio porcentaje.
 */
export function calcularPorcentaje(etapaActualIndex, estadoEtapaActual) {
  const actual = ETAPAS[etapaActualIndex];
  return actual ? actual.porcentaje : 0;
}

export function nombreEtapa(index) {
  return ETAPAS[index]?.nombre ?? "";
}
