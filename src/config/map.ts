/**
 * Enquadramento do mapa e endpoints territoriais.
 *
 * Reexporta os valores de `estado.ts` sob os nomes que a aplicação já importa.
 */
import { ESTADO, URL_MALHA_MUNICIPAL, URL_MUNICIPIOS } from "./estado";

export const CENTRO_DO_ESTADO = ESTADO.centro;
export const LIMITES_DO_ESTADO = ESTADO.limites;
export const MUNICIPAL_MESH_URL = URL_MALHA_MUNICIPAL;
export const MUNICIPALITIES_URL = URL_MUNICIPIOS;
