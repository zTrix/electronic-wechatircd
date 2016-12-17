
function evals(input) {
    var result = '';

    var mode = '';  // '' for normal, '\\' for escape, 'x'|'X' for \x??, 'u'|'U' for \u????
    var arr = [];

    var unescapeMap = {
      '\'': '\'',
      '"' : '"',
      '\\': '\\',
      'b' : '\b',
      'f' : '\f',
      'n' : '\n',
      'r' : '\r',
      't' : '\t',
      'v' : '\v',
      '/' : '/',
    }

    function isHexDigit(x) {
        return (x >= '0' && x <= '9')
            || (x >= 'A' && x <= 'F')
            || (x >= 'a' && x <= 'f')
    }

    for (var i = 0; i < input.length; i++) {
        var chr = input[i];
        
        if (mode === '') {
            if (chr === '\\') {
                mode = '\\';
            } else {
                result += chr;
            }
        } else if (mode === '\\') {
            if (chr in unescapeMap) {
                result += unescapeMap[chr];
                mode = '';
            } else if (chr == 'x' || chr == 'X' || chr == 'u' || chr == 'U') {
                mode = chr;
            } else {
                result += mode + chr;
                mode = '';
            }
        } else if (mode === 'x' || mode === 'X') {
            arr.push(chr);
            if (arr.length == 2) {
                if (isHexDigit(arr[0]) && isHexDigit(arr[1])) {
                    result += String.fromCharCode(parseInt(arr.join(''), 16));
                } else {
                    console.log('mode', mode);
                    result += '\\' + mode + arr.join('');
                }
                mode = '';
                arr = [];
            }
        } else if (mode === 'u' || mode === 'U') {
            arr.push(chr);
            if (arr.length == 4) {
                if (isHexDigit(arr[0]) && isHexDigit(arr[1]) && isHexDigit(arr[2]) && isHexDigit(arr[3])) {
                    result += String.fromCharCode(parseInt(arr.join(''), 16));
                } else {
                    result += '\\' + mode + arr.join('');
                }
                mode = '';
                arr = [];
            }
        }
    }
    if (arr.length) {
        result += '\\' + mode + arr.join('');
    }
    return result;
}

module.exports = evals;
