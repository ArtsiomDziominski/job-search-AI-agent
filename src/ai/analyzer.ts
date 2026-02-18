import OpenAI from 'openai';
import { getOpenAIKey } from '../config';
import { createLogger } from '../logger';

const log = createLogger('AI');

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: getOpenAIKey() });
  }
  return client;
}

export interface AnalysisResult {
  score: number;
  reasoning: string;
}

export async function analyzeJob(
  title: string,
  description: string,
  company: string,
  userSkills: string[]
): Promise<AnalysisResult> {
  const systemPrompt = `You are a job matching assistant. The user has the following skills: ${userSkills.join(', ')}.

Analyze the job posting and determine how well it matches the user's skill set.
Respond ONLY with a JSON object in this exact format:
{"score": <number 0-100>, "reasoning": "<brief explanation in 1-2 sentences>"}

Score guidelines:
- 90-100: Perfect match, all key skills required
- 70-89: Strong match, most skills align
- 50-69: Partial match, some skills overlap
- 30-49: Weak match, few skills relevant
- 0-29: Poor match, skills don't align`;

  const userMessage = `Job Title: ${title}
Company: ${company}
Description: ${description}`;

  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage.substring(0, 4000) },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error('Empty response from OpenAI');

    const parsed = JSON.parse(content) as AnalysisResult;
    log.info(`Analyzed "${title}" -> score: ${parsed.score}`);
    return parsed;
  } catch (err) {
    log.error(`Failed to analyze job "${title}"`, err);
    return { score: 0, reasoning: 'Analysis failed due to an error' };
  }
}

/**
 * Placeholder for future cover letter generation.
 * Will use OpenAI to generate a tailored cover letter for a specific job.
 */
export async function generateCoverLetter(
  title: string,
  description: string,
  company: string,
  userSkills: string[],
  userProfile?: string
): Promise<string> {
  const systemPrompt = `You are an expert career coach. Write a concise, professional cover letter 
for the job posting below. Highlight relevant skills from the candidate's profile. 
Keep it under 300 words.`;

  const userMessage = `Job: ${title} at ${company}
Description: ${description}
Candidate Skills: ${userSkills.join(', ')}
${userProfile ? `Candidate Profile: ${userProfile}` : ''}`;

  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage.substring(0, 4000) },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    return response.choices[0]?.message?.content?.trim() || 'Failed to generate cover letter.';
  } catch (err) {
    log.error('Failed to generate cover letter', err);
    return 'Failed to generate cover letter due to an error.';
  }
}
