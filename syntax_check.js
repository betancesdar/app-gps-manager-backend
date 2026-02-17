const fs = require('fs');
const filename = 'src/controllers/route.controller.js';

try {
    const content = fs.readFileSync(filename, 'utf8');
    // Basic brace counting
    let openBraces = 0;
    let line = 1;
    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
        if (char === '\n') line++;
    }
    console.log(`Open braces: ${openBraces}`);

    // Try to compile it
    const vm = require('vm');
    const script = new vm.Script(content, { filename });
    console.log('Syntax check passed!');
} catch (e) {
    console.error('Syntax check failed:', e);
}
