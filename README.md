ref-struct-bitfield
=============

Forked from [ref-struct-di] and [ref-union-di].

Rewrites `ref-struct-di`, supporting fields redefining and bitfields.

Rewrites `ref-union-di`, supporting fields redefining, toObject() and toJSON().

### Remark

This module offers a "struct" implementation on top of Node.js Buffers using the ref "type" interface.

**Note**: Currently, supports the bitfield same as `VC` only. `gcc` style is not supported.

Installation
------------

Install with `npm`:

``` bash
$ npm install ref-struct-bitfield
```

Examples
--------

Say you wanted to emulate the following struct:

```c
typedef struct {
    __int64 a : 7;
    __int64 b : 2;
    __int64 c : 2;
    char d : 7;
    char e : 2;
    char f : 2;
    int g : 2;
    char h;
    unsigned __int64 i : 2;
    unsigned __int64 j : 62;
    unsigned __int64 k : 1;
} S;
```

Write the javascript code:

```js
const ref = require("ref-napi");
const struct = require("ref-struct-bitfield")(ref);
const bitfield = struct.bitfield;

const S = struct({
	a: bitfield(ref.types.int64, 7),
	b: bitfield("int64", 2),
	c: bitfield("int64", 2),
	d: bitfield("char", 7),
	e: bitfield("char", 2),
	f: bitfield("char", 2),
	g: bitfield("int", 2),
	h: "short",
	i: bitfield("uint64", 2),
	j: bitfield("int64", 62),
	k: bitfield("uint64", 1),
});

// we can redefine an existing field
S.defineProperty("h", ref.types.char);

// and also fields
S.defineProperties({
	i: bitfield("uint64", 2),
	j: bitfield("int64", 62),
	k: bitfield("uint64", 1),
});

// and something interesting you love :)
S
	.defineProperty("h", ref.types.char)
	.defineProperties({
		i: bitfield("uint64", 2),
		j: bitfield("int64", 62),
		k: bitfield("uint64", 1),
	});

// now we can create instances of it
const s = new S;


// once an instance of the struct type is created,
// the struct type is frozen,
// and no more properties may be added to it.
S.defineProperty('l', ref.types.int);
// AssertionError: an instance of this Struct type has already been created, cannot add new "fields" anymore
//      at Function.defineProperty (/path/to/ref-struct-bitfield/src/struct.js:180:3)
```

```c
printf("size: %d\n", sizeof(S));    // 40
```

```js
console.log(S.size);        // 40
console.log(S.alignment);   // 8
```

#### Example of union

```js
const ref = require("ref-napi");
const struct = require("ref-struct-bitfield")(ref);
const bitfield = struct.bitfield;
const union = require("ref-struct-bitfield/union")(ref);

const U = union({
	s: struct({
		a: bitfield("int", 7),
		b: bitfield("int", 2),
		c: bitfield("int", 1),
	}),
	us: struct({
		a: bitfield("uint", 7),
		b: bitfield("uint", 2),
		c: bitfield("uint", 1),
	}),
});

console.log(U.size);    // 4

const u = new U;
u.s.a = 0xFF;
u.s.b = 0xFF;
u.s.c = 1;
console.log(u.toObject());
// {
//      s: { a: -1, b: -1, c: -1 },  // because they are signed integers
//      us: { a: 127, b: 3, c: 1 }
// }
```

License
-------

MIT

[ref-struct-di]: https://github.com/node-ffi-napi/ref-struct-di

[ref-union-di]: https://github.com/node-ffi-napi/ref-union-di
