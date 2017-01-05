const {assert} = require('chai');
const {jsdom} = require('jsdom');

const {and, conserveScore, dom, func, out, rule, ruleset, score, type, typeIn} = require('../index');


describe('Ruleset', function () {
    describe('get()s', function () {
        it('by arbitrary passed-in LHSs (and scores dom() nodes at 1)', function () {
            const doc = jsdom(`
                <div>Hooooooo</div>
            `);
            const rules = ruleset(
                rule(dom('div'), type('paragraphish'))
            );
            const facts = rules.against(doc);
            const div = facts.get(type('paragraphish'))[0];
            assert.equal(div.scoreFor('paragraphish'), 1);
        });

        it('results by out-rule key', function () {
            const doc = jsdom(`
                <div>Hooooooo</div>
            `);
            const rules = ruleset(
                rule(dom('div'), type('paragraphish')),
                rule(type('paragraphish'), out('p'))
            );
            assert.equal(rules.against(doc).get('p').length, 1);
        });

        it('the fnode corresponding to a passed-in node', function () {
            const doc = jsdom(`
                <div>Hooooooo</div>
            `);
            const rules = ruleset(
                rule(dom('div'), type('paragraphish')),  // when we add .score(1), the test passes.
                rule(type('paragraphish'), func(node => ({score: node.element.textContent.length})).typeIn('paragraphish'))
            );
            const facts = rules.against(doc);
            const div = facts.get(doc.querySelectorAll('div')[0]);
            assert.equal(div.scoreFor('paragraphish'), 8);
        });

        it('an empty iterable for nonexistent types', function () {
            // While we're at it, test that querying a nonexistent type from a
            // bound ruleset doesn't crash.
            const rules = ruleset(
                rule(dom('a'), func(n => ({type: 'a'})).typeIn('a', 'b'))
            );
            const facts = rules.against(jsdom('<a></a>'));
            // Tempt it to multiply once:
            assert.deepEqual(facts.get(type('b')), []);
        });
    });

    it('assigns scores and notes to nodes', function () {
        // Test the score() and note() calls themselves as well as the ruleset
        // that obeys them.
        const doc = jsdom(`
            <p>
                <a class="good" href="https://github.com/jsdom">Good!</a>
                <a class="bad" href="https://github.com/jsdom">Bad!</a>
            </p>
        `);
        const rules = ruleset(
            rule(dom('a[class=good]'), score(2).type('anchor').note(fnode => 'lovely'))
        );
        const anchors = rules.against(doc).get(type('anchor'));
        // Make sure dom() selector actually discriminates:
        assert.equal(anchors.length, 1);
        const anchor = anchors[0];
        assert.equal(anchor.scoreFor('anchor'), 2);
        assert.equal(anchor.noteFor('anchor'), 'lovely');
    });

    describe('avoids cycles', function () {
        it('that should be statically detectable, throwing an error', function () {
            const doc = jsdom('<p></p>');
            const rules = ruleset(
                rule(dom('p'), type('a')),
                rule(type('a'), type('b')),
                rule(type('b'), type('a'))
            );
            const facts = rules.against(doc);
            assert.throws(() => facts.get(type('a')),
                          'There is a cyclic dependency in the ruleset.');
        });
    });

    describe('conserves score', function () {
        it('only when conserveScore() is used, using per-type scores otherwise', function () {
            // Also test that rules fire lazily.
            const doc = jsdom(`
                <p></p>
            `);
            const rules = ruleset(
                rule(dom('p'), type('para').score(2)),
                rule(type('para'), type('smoo').score(5)),
                rule(type('para'), conserveScore().type('smee').score(5))
            );
            const facts = rules.against(doc);

            const para = facts.get(type('para'))[0];
            // Show other-typed scores don't backpropagate to the upstream type:
            assert.equal(para.scoreFor('para'), 2);
            // Other rules have had no reason to run yet, so their types' scores
            // remain the default:
            assert.equal(para.scoreFor('smoo'), 1);

            const smoo = facts.get(type('smoo'))[0];
            // Fresh score:
            assert.equal(smoo.scoreFor('smoo'), 5);

            const smee = facts.get(type('smee'))[0];
            // Conserved score:
            assert.equal(smee.scoreFor('smee'), 10);
        });

        it('when rules emitting the same element and type conflict on conservation', function () {
            const doc = jsdom(`
                <p></p>
            `);
            const rules = ruleset(
                rule(dom('p'), type('para').score(2)),
                rule(type('para'), type('smoo').score(5)),
                rule(type('para'), type('smoo').score(7).conserveScore())
            );
            const facts = rules.against(doc);
            const para = facts.get(type('smoo'))[0];
            assert.equal(para.scoreFor('smoo'), 70);
        });

        it('but never factors in a score more than once', function () {
            const doc = jsdom(`
                <p></p>
            `);
            const rules = ruleset(
                rule(dom('p'), type('para').score(2)),
                rule(type('para'), type('smoo').score(5).conserveScore()),
                rule(type('para'), type('smoo').score(7).conserveScore())
            );
            const facts = rules.against(doc);
            const para = facts.get(type('smoo'))[0];
            assert.equal(para.scoreFor('smoo'), 70);
        });
    });

    describe('plans rule execution', function () {
        it('by demanding rules have determinate type', function () {
            assert.throws(() => ruleset(rule(dom('p'), type('a')),
                                        rule(type('a'), func('dummy'))),
                          'Could not determine the emitted type of a rule because its right-hand side calls func() without calling typeIn().');
        });

        it('by remembering what types rules add and emit', function () {
            const rule1 = rule(dom('p'), func('dummy').typeIn('q', 'r'));
            const rule2 = rule(type('r'), type('s'));
            const facts = ruleset(rule1, rule2).against(jsdom(''));
            assert.deepEqual(facts.inwardRulesThatCouldEmit('q'), [rule1]);
            assert.deepEqual(facts.inwardRulesThatCouldAdd('s'), [rule2]);
        });

        it('and avoids unneeded rules', function () {
            const doc = jsdom('<p></p>');
            const rules = ruleset(
                rule(dom('p'), type('a')),
                rule(dom('p'), type('b')),
                rule(type('a'), func(fnode => ({type: 'c'})).typeIn('c')),
                rule(type('b'), func(fnode => ({type: 'd'})).typeIn('d')),
                rule(type('c'), out('c'))
            );
            const facts = rules.against(doc);
            const p = facts.get('c')[0];
            assert(p.hasType('a'));
            assert(!p.hasType('b'));
            assert(p.hasType('c'));
            assert(!p.hasType('d'));
        });
    });

    it('plans for and runs a working and()', function () {
        const doc = jsdom('<a class="smoo"></a><p></p>');
        const rules = ruleset(
            rule(dom('a'), type('A')),
            rule(dom('a[class]'), type('C')),
            rule(dom('a'), type('NEEDLESS')),  // should not be run
            rule(and(type('A'), type('C')), type('BOTH')),
            rule(dom('p'), type('A'))  // A but not C. Tempt and() to grab me.
        );
        const facts = rules.against(doc);
        const boths = facts.get(type('BOTH'));
        assert.equal(boths.length, 1);
        assert.deepEqual(Array.from(boths[0].typesSoFar()), ['C', 'A', 'BOTH']);  // no NEEDLESS was run
    });

    it('takes a subtree of a document and operates on it', function () {
        const doc = jsdom(`
            <div id=root>some text
             <div id=inner>some more text</div>
            </div>
        `);
        const rules = ruleset(
            rule(dom('#root'), type('smoo').score(10)),
            rule(dom('#inner'), type('smoo').score(5)),
            rule(type('smoo').max(), out('best'))
        );
        const facts = rules.against(doc);
        const best = facts.get('best');
        assert.equal(best.length, 1);
        assert.equal(best[0].element.id, 'root');

        const subtree = doc.getElementById('root');
        const subtreeFacts = rules.against(subtree);
        const subtreeBest = subtreeFacts.get('best');
        assert.equal(subtreeBest.length, 1);
        assert.equal(subtreeBest[0].element.id, 'inner');
    });
});

describe('Rule', function () {
    it('knows what it can add and emit', function () {
        const a = rule(dom('p'), type('para'));
        assert.sameMembers(Array.from(a.typesItCouldEmit()), ['para']);
        assert.sameMembers(Array.from(a.typesItCouldAdd()), ['para']);

        const b = rule(type('r'), typeIn('q').func('dummy').typeIn('r', 's'));
        assert.sameMembers(Array.from(b.typesItCouldEmit()), ['r', 's']);
        assert.sameMembers(Array.from(b.typesItCouldAdd()), ['s']);

        const c = rule(type('a'), score(2));
        assert.sameMembers(Array.from(c.typesItCouldEmit()), ['a']);
    });

    it('identifies prerequisite rules', function () {
        const domRule = rule(dom('p'), type('a'));
        const maxRule = rule(type('a').max(), type('b'));
        const maintainRule = rule(type('b'), score(2));
        const addRule = rule(type('b'), type('c'));
        const rules = ruleset(domRule, maxRule, maintainRule, addRule);
        const facts = rules.against(jsdom(''));
        assert.deepEqual(domRule.prerequisites(facts), []);
        assert.deepEqual(maxRule.prerequisites(facts), [domRule]);
        assert.deepEqual(maintainRule.prerequisites(facts), [maxRule]);
        assert.sameMembers(addRule.prerequisites(facts), [maxRule, maintainRule]);

        const prereqs = facts._prerequisitesTo(addRule);
        // TODO: Replace with deepEqual when chai >= 4.0 supports Maps and Sets.
        assert.equal(prereqs.size, 3);
        assert.deepEqual(prereqs.get(maintainRule), [addRule]);
        assert.deepEqual(prereqs.get(domRule), [maxRule]);
        assert.deepEqual(prereqs.get(maxRule), [addRule, maintainRule]);
    });
});


// Maybe there should be a default .score and .note on fnodes that are selected by a type() selector, so we don't have to say scoreFor('someType'), repeating ourselves.
// Decide if * → func(...).score(2) should multiply the score more than once if it just returns the same node over and over. Yes, because it would if you divided it into 2 rules. And if you don't like it, don't return the same element multiple times from func!
