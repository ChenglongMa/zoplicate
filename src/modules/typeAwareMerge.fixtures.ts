import { checkGuardrails, ItemData, scoreTypes } from "./typeAwareMergeHelpers";

// --- Fixtures ---

const baseItem = (id: number, typeName: string, overrides: Partial<ItemData> = {}): ItemData => ({
    id,
    itemTypeID: 0, // Mocked, unused in pure logic if typeNames passed separately
    numAttachments: 0,
    ...overrides
});

export const fixtures: { name: string, items: ItemData[], typeNames: string[], expectedAction: "MERGE" | "SKIP", expectedType?: string }[] = [
    {
        name: "Navarrete: Journal vs Conference (Conflict)",
        items: [
            baseItem(1, "journalArticle", { publicationTitle: "International Journal of Production Economics", title: "Common Title" }),
            baseItem(2, "conferencePaper", { proceedingsTitle: "ICORES 2018 Proceedings", title: "Common Title" })
        ],
        typeNames: ["journalArticle", "conferencePaper"],
        expectedAction: "SKIP"
    },
    {
        name: "Chandra: Springer Book Section",
        items: [
            baseItem(3, "bookSection", { publicationTitle: "Advances in Intelligent Systems", DOI: "10.1007/978-3-642-12345_1" }),
            baseItem(4, "journalArticle", { publicationTitle: "Advances in Intelligent Systems", issue: "12" })
        ],
        typeNames: ["bookSection", "journalArticle"], // Start with mixed
        expectedAction: "MERGE",
        expectedType: "bookSection"
    },
    {
        name: "SSRN Preprint",
        items: [
            baseItem(5, "preprint", { url: "https://ssrn.com/abstract=4575156" }),
            baseItem(6, "webpage", { url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4575156" })
        ],
        typeNames: ["preprint", "webpage"],
        expectedAction: "MERGE",
        expectedType: "preprint"
    },
    {
        name: "Conflicting DOIs",
        items: [
            baseItem(7, "journalArticle", { DOI: "10.1000/1" }),
            baseItem(8, "journalArticle", { DOI: "10.1000/2" })
        ],
        typeNames: ["journalArticle", "journalArticle"],
        expectedAction: "SKIP"
    },
    {
        name: "Ambiguous Low Info",
        items: [
            baseItem(9, "book", { title: "Some Book" }), // 'book' not in TARGET_TYPES (defaults 0 score)
            baseItem(10, "webpage", { title: "Some Book Info" }) // 'webpage' in TARGET_TYPES (defaults 0 score)
        ],
        typeNames: ["book", "webpage"],
        expectedAction: "SKIP"
    },
    {
        name: "Journal with Proceedings Title (Soft Constraint)",
        items: [
            baseItem(11, "journalArticle", { publicationTitle: "Proceedings of XYZ", title: "Paper A", DOI: "10.1234/567" }),
            baseItem(12, "conferencePaper", { proceedingsTitle: "Proceedings of XYZ", title: "Paper A", DOI: "10.1234/567" })
        ],
        typeNames: ["journalArticle", "conferencePaper"],
        expectedAction: "MERGE",
        expectedType: "conferencePaper"
    }
];

export function runSelfCheck() {
    console.log("--- Type-Aware Merge Logic Self-Check ---");
    let passed = 0;
    for (const f of fixtures) {
        console.log(`Checking: ${f.name}`);
        const guard = checkGuardrails(f.items, f.typeNames);

        let resultAction = "PROCEED";
        let resultType = "";
        let evidence: string[] = [];
        let skipCode: string | null = null;
        let confidence = { score: 0, margin: 0 };

        if (guard.actions === "SKIP") {
            resultAction = "SKIP";
            evidence = guard.evidence || [];
            skipCode = guard.skipCode || "GUARDRAIL";
        } else {
            const score = scoreTypes(f.items, f.typeNames);
            evidence = score.evidence;
            confidence = { score: score.topScore, margin: score.margin };

            if (score.topScore >= 6 && score.margin >= 2) {
                resultAction = "MERGE";
                resultType = score.topType;
            } else {
                resultAction = "SKIP"; // Ambiguous
                skipCode = "AMBIGUOUS_TYPE";
            }
        }

        const actionMatch = resultAction === f.expectedAction;
        const typeMatch = !f.expectedType || resultType === f.expectedType;

        if (actionMatch && typeMatch) {
            console.log("  PASS");
            if (resultAction === "SKIP") {
                console.log(`    SkipCode: ${skipCode}`);
                console.log(`    Evidence: ${JSON.stringify(evidence)}`);
            } else {
                console.log(`    Confidence: score=${confidence.score}, margin=${confidence.margin}`);
                console.log(`    Evidence: ${JSON.stringify(evidence)}`);
            }
            passed++;
        } else {
            console.error(`  FAIL! Expected ${f.expectedAction} (${f.expectedType}), got ${resultAction} (${resultType})`);
            console.error(`    Evidence: ${JSON.stringify(evidence)}`);
        }
    }
    console.log(`--- Result: ${passed}/${fixtures.length} Passed ---`);
}
