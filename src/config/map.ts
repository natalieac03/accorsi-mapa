/**
 * Enquadramento do mapa e endpoints territoriais.
 *
 * Os valores concretos vivem em `estado.ts` — este arquivo mantém apenas os
 * nomes que o resto da aplicação já importa, para que trocar de estado
 * continue sendo uma edição em um arquivo só.
 */
import { ESTADO, URL_MALHA_MUNICIPAL, URL_MUNICIPIOS } from "./estado";

export const CENTRO_DO_ESTADO = ESTADO.centro;
export const LIMITES_DO_ESTADO = ESTADO.limites;
export const MUNICIPAL_MESH_URL = URL_MALHA_MUNICIPAL;
export const MUNICIPALITIES_URL = URL_MUNICIPIOS;
