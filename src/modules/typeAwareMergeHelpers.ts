export type ItemData = {
    itemTypeID: number;
    title?: string;
    creators?: { firstName?: string; lastName?: string; creatorType?: string }[];
    url?: string;
    DOI?: string;
    ISBN?: string;
    publicationTitle?: string;
    proceedingsTitle?: string;
    publisher?: string;
    volume?: string;
    pages?: string;
    issue?: string;
    series?: string;
    date?: string;
    abstractNote?: string;
    numAttachments: number;
    id: number; // For logging
};

// --- Strong ID Extraction ---

export function normalizeDOI(doi?: string): string | null {
    if (!doi) return null;
    const match = doi.match(/10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+/);
    return match ? match[0].toLowerCase() : null;
}

export function normalizeISBN(isbn?: string): string | null {
    if (!isbn) return null;
    const clean = isbn.replace(/[^0-9X]/gi, '');
    return clean.length >= 10 ? clean : null;
}

export function extractSSRNId(url?: string): string | null {
    if (!url) return null;
    if (!url.toLowerCase().includes('ssrn.com')) return null;

    const abstractMatch = url.match(/(?:abstract_id=|abstract=)(\d+)/i);
    if (abstractMatch) return abstractMatch[1];

    // Sometimes it's in the path? Less common but possible.
    return null;
}

export function getUrlHost(url?: string): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        return u.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return null;
    }
}

export function isScopusUrl(url?: string): boolean {
    return !!url && url.toLowerCase().includes('scopus.com/inward/record.uri');
}


// --- Guardrails ---

export function checkGuardrails(items: ItemData[], typeNames: string[]): { actions: "SKIP" | "PROCEED", reason?: string, skipCode?: string, evidence?: string[] } {
    const evidence: string[] = [];

    // 1. Conflicting DOIs
    const dois = new Set<string>();
    for (const item of items) {
        const d = normalizeDOI(item.DOI);
        if (d) dois.add(d);
    }
    if (dois.size > 1) {
        evidence.push(`Found conflicting DOIs: ${Array.from(dois).join(', ')}`);
        return {
            actions: "SKIP",
            reason: `Conflicting DOIs: ${Array.from(dois).join(', ')}`,
            skipCode: "CONFLICTING_DOI",
            evidence
        };
    }

    // 2. Journal vs Conference Conflict (if no shared Strong ID)
    const hasSharedDOI = dois.size === 1;

    if (!hasSharedDOI) {
        const types = new Set(typeNames);
        const hasJournal = types.has("journalArticle");
        const hasConf = types.has("conferencePaper");

        if (hasJournal && hasConf) {
            evidence.push("Cluster contains both 'journalArticle' and 'conferencePaper' without a unifying DOI.");
            return {
                actions: "SKIP",
                reason: "Journal vs Conference mismatch without shared DOI",
                skipCode: "TYPE_MISMATCH",
                evidence
            };
        }
    }

    return { actions: "PROCEED", evidence };
}

// --- Fast Path ---

export interface FastPathResult {
    match: boolean;
    type?: string;
    reason?: string;
    evidence?: string[];
    confidence?: { score: number, margin: number };
}

export function checkFastPath(items: ItemData[]): FastPathResult {
    const evidence: string[] = [];

    // 1. DOI Fast Path
    // Strict: All items must share the same non-empty DOI
    const firstDOI = normalizeDOI(items[0].DOI);
    if (firstDOI) {
        const allMatch = items.every(i => normalizeDOI(i.DOI) === firstDOI);
        if (allMatch) {
            evidence.push(`Shared DOI across all items: ${firstDOI}`);

            // Infer Type from DOI/Metadata
            let type = "journalArticle"; // Default for DOI
            let reason = "Shared DOI (Default: journalArticle)";

            // Check Metadata signals
            const hasProceedingsInfo = items.some(i =>
                (i.proceedingsTitle || "").match(/proc\.|proceedings/i) ||
                (i.publicationTitle || "").match(/proc\.|proceedings/i)
            );

            if (firstDOI.startsWith("10.1117/") || hasProceedingsInfo) {
                type = "conferencePaper";
                reason = "Shared DOI + Proceedings signal";
            } else if (items.some(i => (i.publicationTitle || "").toLowerCase().startsWith("advances in"))) {
                type = "bookSection";
                reason = "Shared DOI + 'Advances in' signal";
            }

            return {
                match: true,
                type,
                reason,
                evidence,
                confidence: { score: 20, margin: 20 }
            };
        }
    }

    // 2. SSRN Fast Path
    const firstSSRN = extractSSRNId(items[0].url);
    if (firstSSRN) {
        const allMatch = items.every(i => extractSSRNId(i.url) === firstSSRN);
        if (allMatch) {
            evidence.push(`Shared SSRN ID across all items: ${firstSSRN}`);
            return {
                match: true,
                type: "preprint",
                reason: "Shared SSRN ID",
                evidence,
                confidence: { score: 20, margin: 20 }
            };
        }
    }

    // 3. URL Fast Path (Only if no DOIs/ISBNs to avoid weak matches overshadowing specific ones?)
    // Actually, if they strictly share the same URL, it's pretty strong.
    // But we check ensure no conflicting DOIs (handled by guardrails).
    // And ensure no partial DOIs (if one has DOI, we prefer DOI path or heuristic).
    // User: "If identical normalized URL across cluster and no strong scholarly IDs"
    const hasAnyStrongID = items.some(i => !!i.DOI || !!i.ISBN || !!extractSSRNId(i.url));
    if (!hasAnyStrongID) {
        const firstUrl = items[0].url;
        // Normalize URL: naive check or reuse getUrlHost? 
        // User said "identical normalized URL". Let's do simple normalization (trim, lower check?)
        // Or strictly identical. 
        if (firstUrl) {
            const allMatch = items.every(i => i.url === firstUrl); // Strict equality for now
            if (allMatch) {
                evidence.push("Identical URL across all items (No DOIs)");
                return {
                    match: true,
                    type: "webpage",
                    reason: "Identical URL (No Strong IDs)",
                    evidence,
                    confidence: { score: 10, margin: 10 }
                };
            }
        }
    }

    return { match: false };
}


// --- Scoring ---

const TARGET_TYPES = ['journalArticle', 'bookSection', 'conferencePaper', 'preprint', 'webpage'];

export function scoreTypes(items: ItemData[], typeNames: string[]): { topType: string, topScore: number, margin: number, scores: Record<string, number>, evidence: string[] } {
    const scores: Record<string, number> = {
        journalArticle: 0,
        bookSection: 0,
        conferencePaper: 0,
        preprint: 0,
        webpage: 0
    };
    const evidence: string[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const typeName = typeNames[i];

        const host = getUrlHost(item.url);
        const doi = normalizeDOI(item.DOI);
        const pubTitle = (item.publicationTitle || item.proceedingsTitle || "").toLowerCase();

        // -- Signals --

        // Book Section
        if (item.issue && item.issue.toLowerCase().includes('advances in')) {
            scores.bookSection += 3;
            evidence.push(`Item ${item.id}: 'advances in' found in issue (+3 bookSection)`);
        }
        if (pubTitle.startsWith('advances in')) {
            scores.bookSection += 3;
            evidence.push(`Item ${item.id}: 'advances in' start of pubTitle (+3 bookSection)`);
        }
        if (doi && doi.startsWith('10.1007/')) {
            scores.bookSection += 1; // Springer often books
            evidence.push(`Item ${item.id}: DOI starts with 10.1007 (+1 bookSection)`);
        }
        if (typeName === 'bookSection') scores.bookSection += 2;

        // Conference Paper
        if (pubTitle.match(/proc\.|proceedings|int\.|conference|symposium/i)) {
            scores.conferencePaper += 4;
            evidence.push(`Item ${item.id}: 'proceedings' signal in pubTitle (+4 conferencePaper)`);
        }
        if (item.publisher && item.publisher.match(/ieee|acm|spie/i)) {
            scores.conferencePaper += 2;
            evidence.push(`Item ${item.id}: Publisher signal (+2 conferencePaper)`);
        }
        if (doi && doi.startsWith('10.1117/')) {
            scores.conferencePaper += 4;
            evidence.push(`Item ${item.id}: SPIE DOI 10.1117 (+4 conferencePaper)`);
        }
        if (typeName === 'conferencePaper') scores.conferencePaper += 2;

        // Preprint
        if (host === 'ssrn.com' || extractSSRNId(item.url)) {
            scores.preprint += 5;
            evidence.push(`Item ${item.id}: SSRN signal (+5 preprint)`);
        }
        if (host === 'arxiv.org') {
            scores.preprint += 5;
            evidence.push(`Item ${item.id}: Arxiv signal (+5 preprint)`);
        }
        if (typeName === 'preprint') scores.preprint += 2;

        // Journal Article
        if (item.volume && item.issue && item.pages && typeName === 'journalArticle') {
            scores.journalArticle += 3;
            evidence.push(`Item ${item.id}: Full journal metadata present (+3 journalArticle)`);
        }
        if (typeName === 'journalArticle' && !pubTitle.match(/proc\.|proceedings/i)) {
            scores.journalArticle += 1;
        }

        // Webpage
        if (item.url && !doi && !extractSSRNId(item.url) && typeName === 'webpage') {
            scores.webpage += 3;
            evidence.push(`Item ${item.id}: URL only, no DOI (+3 webpage)`);
        }

        // Negative Constraints (Soft)
        if (typeName === 'journalArticle' && pubTitle.match(/proc\.|proceedings/i)) {
            scores.journalArticle -= 2;
            evidence.push(`Item ${item.id}: 'journalArticle' type but 'proceedings' title (-2 journalArticle)`);
        }
    }

    // Determine Winner
    let sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const second = sorted[1];

    return {
        topType: top[0],
        topScore: top[1],
        margin: top[1] - (second ? second[1] : 0),
        scores,
        evidence
    };
}

// --- Master Selection ---

export function selectMaster(items: ItemData[]): number {
    // Return ID of best candidate
    let bestId = items[0].id;
    let maxScore = -1;

    for (const item of items) {
        let score = 0;
        if (item.DOI) score += 2;
        if (item.ISBN) score += 2;
        if (item.publicationTitle) score += 1;
        if (item.date) score += 1;
        if (item.abstractNote) score += 1;
        score += (item.numAttachments * 1.5); // Prefer items with PDF

        if (score > maxScore) {
            maxScore = score;
            bestId = item.id;
        }
    }
    return bestId;
}
