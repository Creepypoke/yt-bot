import { Composer } from 'gramio'

export const composer = new Composer({ name: 'main' }).as('scoped')

export type BotType = typeof composer
