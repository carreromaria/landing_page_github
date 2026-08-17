// ============================================================
// LINENCE — Seguimiento de Proyectos
// Configuración de etapas y cálculo automático de porcentaje
// ============================================================
// En la Fase 5 esta lista se leerá desde Firestore (config/etapas).
// Por ahora vive aquí como fuente única de verdad para el maquetado.

export const ETAPAS = [
  { index: 0,  nombre: "Cotización aceptada",                    porcentaje: 0   },
  { index: 1,  nombre: "Recepción de abono",                     porcentaje: 9   },
  { index: 2,  nombre: "Rectificación de medida y renderizado 3D", porcentaje: 18  },
  { index: 3,  nombre: "Optimización de materiales",             porcentaje: 27  },
  { index: 4,  nombre: "Compra de materiales",                   porcentaje: 36  },
  { index: 5,  nombre: "Corte de materiales",                    porcentaje: 45  },
  { index: 6,  nombre: "Armado",                                 porcentaje: 55  },
  { index: 7,  nombre: "Control de Calidad",                     porcentaje: 64  },
  { index: 8,  nombre: "Embalaje",                                porcentaje: 73  },
  { index: 9,  nombre: "Coordinación de instalación",            porcentaje: 82  },
  { index: 10, nombre: "Instalación",                             porcentaje: 91  },
  { index: 11, nombre: "Entrega del proyecto",                   porcentaje: 100 }
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
