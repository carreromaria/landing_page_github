// ============================================================
// LINENCE — Seguimiento de Proyectos
// Capa de acceso a Firebase Storage (fotografías)
// ============================================================

import { storage } from './firebase-config.js';
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10MB, igual que storage.rules
const TAMANO_MAXIMO_VIDEO = 15 * 1024 * 1024; // 15MB, para cuidar el plan gratuito de Storage

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
 * Valida un video antes de subir. La duración (máx. 20 segundos) no se
 * valida automáticamente — se le pide al equipo que grabe clips cortos.
 * El límite de tamaño sí se valida acá para cuidar el plan gratuito.
 */
export function validarVideo(file) {
  if (!file.type.startsWith('video/')) {
    return 'Solo se permiten archivos de video.';
  }
  if (file.size > TAMANO_MAXIMO_VIDEO) {
    return 'El video supera el límite de 15MB. Recuerda: clips cortos, de máximo 20 segundos.';
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

/**
 * Sube un video corto al proyecto. Misma lógica que subirFoto, pero
 * se guarda en una subcarpeta separada (proyectos/{codigo}/videos/)
 * para mantener ordenado el Storage. Devuelve { url, storagePath }.
 */
export function subirVideo(codigo, file, onProgreso) {
  return new Promise((resolve, reject) => {
    const nombreArchivo = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const storagePath = `proyectos/${codigo}/videos/${nombreArchivo}`;
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
