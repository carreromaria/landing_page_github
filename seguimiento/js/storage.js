// ============================================================
// LINENCE — Seguimiento de Proyectos
// Capa de acceso a Firebase Storage (fotografías)
// ============================================================

import { storage } from './firebase-config.js';
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10MB, igual que storage.rules

/**
 * Valida el archivo en el cliente ANTES de subir (misma regla que
 * storage.rules, así el usuario ve el error al instante sin esperar
 * el rechazo del servidor).
 */
export function validarFoto(file) {
  if (!file.type.startsWith('image/')) {
    return 'Solo se permiten archivos de imagen.';
  }
  if (file.size > TAMANO_MAXIMO) {
    return 'La imagen supera el límite de 10MB.';
  }
  return null;
}

/**
 * Sube una fotografía al proyecto. onProgreso(porcentaje) se llama
 * durante la subida para mostrar una barra de avance.
 * Devuelve { url, storagePath }.
 */
export function subirFoto(codigo, file, onProgreso) {
  return new Promise((resolve, reject) => {
    const nombreArchivo = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const storagePath = `proyectos/${codigo}/${nombreArchivo}`;
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, file);

    task.on('state_changed',
      (snapshot) => {
        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgreso?.(pct);
      },
      (error) => reject(error),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ url, storagePath });
      }
    );
  });
}

/** Elimina una fotografía de Storage dado su storagePath. */
export async function eliminarFotoStorage(storagePath) {
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
}

/**
 * Elimina TODAS las fotografías de un proyecto en Storage (se usa
 * al borrar el proyecto completo). Si alguna falla, sigue con las
 * demás — no queremos que una foto ya borrada trabe todo el proceso.
 */
export async function eliminarTodasLasFotos(fotos) {
  await Promise.allSettled(
    (fotos || []).map(f => eliminarFotoStorage(f.storagePath))
  );
}
