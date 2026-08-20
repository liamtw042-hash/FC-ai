import { NextResponse } from 'next/server'
import { detectConflicts } from '../../../../src/rules/detectConflicts'
import { getFormation } from '../../../../src/rules/formations'
import { storeSbc, type SbcDefinition } from '../../../lib/server'

export async function POST(request: Request): Promise<NextResponse> {
  const definition = (await request.json()) as SbcDefinition
  if (typeof definition.name !== 'string' || definition.name.trim() === '') {
    return NextResponse.json({ error: 'an SBC needs a name' }, { status: 400 })
  }
  try {
    getFormation(definition.formation)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 })
  }
  // Saved WITH its conflicts reported rather than refused: an SBC the game
  // really does list can be impossible, and recording it is not the same as
  // pretending it will solve.
  const conflicts = detectConflicts(definition.requirements ?? []).map((entry) => entry.reason)
  const path = storeSbc({ ...definition, requirements: definition.requirements ?? [] })
  return NextResponse.json({ path, conflicts })
}
