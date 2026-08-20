import { NextResponse } from 'next/server'
import { detectConflicts } from '../../../../src/rules/detectConflicts'
import { parseRequirementText } from '../../../../src/rules/parseRequirementText'

/**
 * The paste parser, always showing the parse for confirmation. Brief section 9.
 *
 * Returns EVERY line, parsed or not. Nothing is saved here: the page shows what
 * was understood and what was not, and saving is a separate deliberate step.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { text?: string }
  const result = parseRequirementText(body.text ?? '')
  return NextResponse.json({
    lines: result.lines,
    requirements: result.requirements,
    unrecognised: result.unrecognised,
    conflicts: detectConflicts(result.requirements).map((conflict) => conflict.reason),
  })
}
