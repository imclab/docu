/*global env: true */
var template = require('jsdoc/template'),
    fs = require('jsdoc/fs'),
    path = require('jsdoc/path'),
    taffy = require('taffydb').taffy,
    handle = require('jsdoc/util/error').handle,
    helper = require('jsdoc/util/templateHelper'),
    util = require('util'),
    htmlsafe = helper.htmlsafe,
    linkto = helper.linkto,
    resolveAuthorLinks = helper.resolveAuthorLinks,
    scopeToPunc = helper.scopeToPunc,
    hasOwnProp = Object.prototype.hasOwnProperty,
    data,
    view,
    outdir = env.opts.destination;


/**
    @param {TAFFY} taffyData See <http://taffydb.com/>.
    @param {object} opts
    @param {Tutorial} tutorials
 */
exports.publish = function(taffyData, opts, tutorials) {
    data = taffyData;

    var conf = env.conf.templates || {};
    conf['default'] = conf['default'] || {};

    var templatePath = opts.template;
    view = new template.Template(templatePath + '/tmpl');

    // claim some special filenames in advance, so the All-Powerful Overseer of Filename Uniqueness
    // doesn't try to hand them out later
    var indexUrl = helper.getUniqueFilename('index');
    // don't call registerLink() on this one! 'index' is also a valid longname

    var globalUrl = helper.getUniqueFilename('global');
    helper.registerLink('global', globalUrl);

    // set up templating
    view.layout = 'layout.tmpl';

    //cleanup data
    data = helper.prune(data);
    data.sort('longname, version, since');

    var sourceFiles = {};
    var sourceFilePaths = [];

    //create lists of source files and paths
    readSourceFilesAndPaths(sourceFiles,sourceFilePaths);


    //find namespaces
    var namespaces = [];
    var hasNameSpace = ( find({kind: 'namespace'}) || [] );
    for( var ns in hasNameSpace)
    {
        var longdirname = hasNameSpace[ns].longname.replace(".","/");
        namespaces.push(longdirname);
    }

    //find components
    var components = [];
    var hasComponents = ( find({component:{isUndefined: false}}) || [] );

    for(var hc in hasComponents)
    {
        components.push(hasComponents[hc].component);
    }

    //create folder structure
    createFolderStructure(outdir,namespaces, components );

    //copy static files
    copyStaticFiles(templatePath);

    //shorten pathes
    shortenSourceFilePaths(sourceFilePaths, sourceFiles);

    //add signatures
    data().each(function(doclet) {
        var url = helper.longnameToUrl[doclet.longname];

        if (url.indexOf('#') > -1) {
            doclet.id = helper.longnameToUrl[doclet.longname].split(/#/).pop();
        }
        else {
            doclet.id = doclet.name;
        }

        if ( needsSignature(doclet) ) {
            addSignatureParams(doclet);
            addSignatureReturns(doclet, doclet.kind != 'function');
            addAttribs(doclet);
        }
    });

    // do this after the urls have all been generated
    data().each(function(doclet) {
        doclet.ancestors = getAncestorLinks(doclet);

        if (doclet.kind === 'member') {
            addSignatureTypes(doclet);
            addAttribs(doclet);
        }

        if (doclet.kind === 'constant') {
            addSignatureTypes(doclet);
            addAttribs(doclet);
            doclet.kind = 'member';
        }
    });

    //get data of member
    var typeLists = getLists();

    // add template helpers
    view.find = find;
    view.linkto = linkto;
    view.linkFromTo = linkFromTo;
    view.linkFromContextTo = linkFromContextTo;
    view.resolveAuthorLinks = resolveAuthorLinks;
    view.htmlsafe = htmlsafe;
    view.context = null;
    view.typeLists = typeLists;
    view.disassemble = disassemble;

    for (var longname in helper.longnameToUrl) {
        if ( hasOwnProp.call(helper.longnameToUrl, longname) ) {

            //generate classes
            var myClasses = helper.find(taffy(typeLists.classes), {longname: longname});
            if (myClasses.length)
            {
                view.api = "full";
                generateClass('Class: ' + myClasses[0].name, myClasses, createFullApiPathWithFolders(outdir, "full."+helper.longnameToUrl[longname], false, true));
            }

            //generate X3D Nodes
            var x3dNodes = helper.find(taffy(typeLists.x3dNodes), {longname: longname});
            if (x3dNodes.length)
            {
                //console.log(x3dNodes[0].name+ " " +x3dNodes[0].x3d + " " + x3dNodes[0].component);
                view.api = "node";
                generateX3DNode('Node: ' + x3dNodes[0].name, x3dNodes, createNodeApiPathWithFolders(outdir, x3dNodes[0], "node."+helper.longnameToUrl[longname]));
            }

            //generate namespace overviews
            var namespaces = helper.find(taffy(typeLists.namespaces), {longname: longname});
            if (namespaces.length)
            {
                view.api = "full";
                generateNameSpaceIndex('Namespace: ' + namespaces[0].name, namespaces, createFullApiPathWithFolders(outdir, "full."+helper.longnameToUrl[longname],true,true));
            }
        }
    }

    //generateClassIndex('Class: ' + myClasses[0].name, myClasses, createFullApiPathWithFolders(outdir, "full."+helper.longnameToUrl[longname], false, true));


};

//----------------------------------------------------------------------------------------------------------------------

function createNodeApiPathWithFolders(outdir,doc,url)
{
    var desc = disassemble(url,true,/\./g);

    return desc.path[0]+"/"+doc.component+"/"+desc.name+ "." + desc.ending;
}


//----------------------------------------------------------------------------------------------------------------------

function createFullApiPathWithFolders(outdir, url, isNamespace, hasEnding)
{
    hasEnding = (hasEnding !== undefined) ? hasEnding : true;
    isNamespace = (isNamespace !== undefined) ? isNamespace : false;
    var desc = disassemble(url, hasEnding, /\./g);

    var path = desc.path.toString().replace(/,/g,"/");
    var val = isNamespace ?
        path+"/"+desc.name+"/index." + desc.ending :
        path+"/"+desc.name+ "." + desc.ending;

    //console.log(url + " "+val);
    return val;
}

//----------------------------------------------------------------------------------------------------------------------

function getPathFromDoclet(doclet) {
    if (!doclet.meta) {
        return;
    }

    var filepath = doclet.meta.path && doclet.meta.path !== 'null' ?
        doclet.meta.path + '/' + doclet.meta.filename :
        doclet.meta.filename;

    return filepath;
}

//----------------------------------------------------------------------------------------------------------------------

function shortenPaths(files, commonPrefix) {
    // always use forward slashes
    var regexp = new RegExp('\\\\', 'g');

    Object.keys(files).forEach(function(file)
    {
        files[file].shortened = files[file].resolved.replace(commonPrefix, '')
            .replace(regexp, '/');
        //console.log(files[file].shortened +" <-" + files[file].resolved );
    });

    return files;
}

//----------------------------------------------------------------------------------------------------------------------

function find(spec)
{
    return helper.find(data, spec);
}

//----------------------------------------------------------------------------------------------------------------------

function resolveSourcePath(filepath)
{
    return path.resolve(process.cwd(), filepath);
}

//----------------------------------------------------------------------------------------------------------------------

/**
 * read sourcefiles and paths from data
 * @param sourceFiles - source file list target object
 * @param sourceFilePaths - source file paths target object
 */
function readSourceFilesAndPaths(sourceFiles, sourceFilePaths)
{
    data().each(function(doclet)
    {
        doclet.attribs = '';

        // build a list of source files
        var sourcePath;
        var resolvedSourcePath;
        if (doclet.meta) {
            sourcePath = getPathFromDoclet(doclet);
            resolvedSourcePath = resolveSourcePath(sourcePath);
            sourceFiles[sourcePath] = {
                resolved: resolvedSourcePath,
                shortened: null
            };
            sourceFilePaths.push(resolvedSourcePath);
        }
    });
}

//----------------------------------------------------------------------------------------------------------------------

/**
 * Create the full folder structure for the documentation
 * @param outdir - output directory
 */
function createFolderStructure(outdir, namespaces, components)
{
    //Create outdir
    if(fs.existsSync(outdir))
    {
        console.log("outdir:' "+outdir +" 'not deletet - should be deleted first !");
    }
    else
        fs.mkPath(outdir);


    //Create base folders
    var baseFolders =
    [
        "/full/", "/node/"
    ];

    for(var path in baseFolders)
    {
        fs.mkPath(outdir+baseFolders[path]);
    }

    //create namespace folders
    for(var ldr in namespaces)
    {
        fs.mkPath(outdir+"/full/"+namespaces[ldr]);
    }

    //create component folders
    for(var cmp in components)
    {
        fs.mkPath(outdir+"/node/"+components[cmp]);
    }
}

//----------------------------------------------------------------------------------------------------------------------

function copyStaticFiles (templatePath)
{
    // copy static files to outdir
    var fromDir = path.join(templatePath, 'static'),
        staticFiles = fs.ls(fromDir, 3);

    staticFiles.forEach(function(fileName) {
        var toDir = fs.toDir( fileName.replace(fromDir, outdir+"/static/") );
        fs.mkPath(toDir);
        fs.copyFileSync(fileName, toDir);
    });

    // copy static files to outdir
    var fromDir = path.join(templatePath, 'base'),
        baseFiles = fs.ls(fromDir, 50);

    baseFiles.forEach(function(fileName) {
        var toDir = fs.toDir( fileName.replace(fromDir, outdir+"") );
        fs.mkPath(toDir);
        fs.copyFileSync(fileName, toDir);
    });

}

//----------------------------------------------------------------------------------------------------------------------

function shortenSourceFilePaths(sourceFilePaths, sourceFiles)
{
    if (sourceFilePaths.length)
    {
        sourceFiles = shortenPaths( sourceFiles, path.commonPrefix(sourceFilePaths) );
    }
    data().each(function(doclet)
    {
        var url = helper.createLink(doclet);

        //register links
        helper.registerLink(doclet.longname, url);

        // replace the filename with a shortened version of the full path
        var docletPath;
        if (doclet.meta) {
            docletPath = getPathFromDoclet(doclet);
            docletPath = sourceFiles[docletPath].shortened;
            if (docletPath)
            {
                doclet.meta.filename = docletPath;
            }
        }
    });
}

//----------------------------------------------------------------------------------------------------------------------

function needsSignature(doclet)
{
    var needsSig = false;

    // function and class definitions always get a signature
    if (doclet.kind === 'function' || doclet.kind === 'class') {
        needsSig = true;
    }
    // typedefs that contain functions get a signature, too
    else if (doclet.kind === 'typedef' && doclet.type && doclet.type.names &&
        doclet.type.names.length) {
        for (var i = 0, l = doclet.type.names.length; i < l; i++) {
            if (doclet.type.names[i].toLowerCase() === 'function') {
                needsSig = true;
                break;
            }
        }
    }

    return needsSig;
}

//----------------------------------------------------------------------------------------------------------------------

function addSignatureParams(f)
{
    var params = helper.getSignatureParams(f, 'optional');

    f.signature = (f.signature || '') + '('+params.join(', ')+')';
}

//----------------------------------------------------------------------------------------------------------------------

function addSignatureReturns(f, format)
{
    format = format !== undefined ? format : true;

    var returnTypes = [];

    if (f.returns)
    {
        f.returns.forEach(function(r)
        {
            if (r.type && r.type.names)
            {
                if (!returnTypes.length)
                {
                    returnTypes = r.type.names;
                }
            }
        });
    }

    if (format && returnTypes && returnTypes.length)
    {
        returnTypes = returnTypes.map(function(r) {
            return linkto(r, htmlsafe(r));
        });
    }

    f.sigRet =
    {
        "pre" :  '<span class="signature">'+(f.signature || '') + '</span>' + '<span class="type-signature">',
        "longname" : returnTypes.length ? returnTypes[0] : undefined,
        "post" : '</span>'
    };

    f.signature = '<span class="signature">'+(f.signature || '') + '</span>' + '<span class="type-signature">'+(returnTypes.length? ' &rarr; {'+returnTypes.join('|')+'}' : '')+'</span>';
}

//----------------------------------------------------------------------------------------------------------------------

function addSignatureTypes(f)
{
    var types = helper.getSignatureTypes(f);

    f.signature = (f.signature || '') + '<span class="type-signature">'+(types.length? ' :'+types.join('|') : '')+'</span>';
}

//----------------------------------------------------------------------------------------------------------------------

function addAttribs(f)
{
    var attribs = helper.getAttribs(f);

    f.attribs = '<span class="type-signature">'+htmlsafe(attribs.length? '<'+attribs.join(', ')+'> ' : '')+'</span>';
}

//----------------------------------------------------------------------------------------------------------------------

function getAncestorLinks(doclet)
{
    var from = doclet;
    var ancestors = [],
        doc = doclet.memberof;

    while (doc)
    {
        doc = helper.find( data, {longname: doc}, false );
        if (doc) { doc = doc[0]; }
        if (!doc) { break; }
        ancestors.unshift( linkFromTo( from.longname, from.kind == "namespace", doc.longname, doc.kind == "namespace" ,(helper.scopeToPunc[doc.scope] || '') + doc.name) );
        doc = doc.memberof;
    }
    if (ancestors.length)
    {
        ancestors[ancestors.length - 1] += (helper.scopeToPunc[doclet.scope] || '');
    }
    return ancestors;
}

//----------------------------------------------------------------------------------------------------------------------

function getLists()
{
    return {
        classes: find( {kind: 'class'} ),
        x3dNodes: find( { kind: 'class', x3d:{isUndefined: false}, component:{ isUndefined: false}}),
        externals: find( {kind: 'external'} ),
        events: find( {kind: 'event'}),
        globals: find( { kind: ['member', 'function', 'constant', 'typedef'], memberof: { isUndefined: true }}),
        //mixins: find( {kind: 'mixin'} ),
        //modules: find({kind: 'module'} ),
        namespaces: find( {kind: 'namespace'} )
    };
}

//----------------------------------------------------------------------------------------------------------------------

function generateClass(title, docs, filename, resolveLinks)
{
    resolveLinks = resolveLinks === false ? false : true;

    var  docData = {
        title: title,
        docs: docs,
        filename: filename
    };

    var outpath = path.join(outdir , filename),
    html = view.render('classContainer.tmpl', docData);
    fs.writeFileSync(outpath, html, 'utf8');
}

//----------------------------------------------------------------------------------------------------------------------

function generateX3DNode(title, docs, filename, resolveLinks)
{
    resolveLinks = resolveLinks === false ? false : true;

    var  docData = {
        title: title,
        docs: docs,
        filename: filename
    };

    var outpath = path.join(outdir , filename),
        html = view.render('classContainer.tmpl', docData);
    fs.writeFileSync(outpath, html, 'utf8');
}

//----------------------------------------------------------------------------------------------------------------------

function generateNameSpaceIndex(title, docs, filename, resolveLinks)
{
    resolveLinks = resolveLinks === false ? false : true;

    var docData = {
        title: title,
        docs: docs,
        filename: filename
    };

    var outpath = path.join(outdir , filename),
        html = view.render('namespaceContainer.tmpl', docData);
    fs.writeFileSync(outpath, html, 'utf8');
}

//----------------------------------------------------------------------------------------------------------------------

function generateClassesIndex(classes)
{
    var docData = {
        title: "Classes",

        filename: "full/Classes.html"
    };

    var outpath = path.join(outdir , filename),
        html = view.render('namespaceContainer.tmpl', docData);
    fs.writeFileSync(outpath, html, 'utf8');
}

//----------------------------------------------------------------------------------------------------------------------

function disassemble(longname, hasEnding, del, isNamespace)
{
    var isNamespace = isNamespace !== undefined ? isNamespace : false;
    var del = del !== undefined ? del : /\./g;


    var parts = longname.split(del);
    var ending = hasEnding ? parts.pop() : "";
    var name = isNamespace ? "" : parts.pop();

    return {
        path : parts,
        ending : ending,
        name: name
    };
}
//----------------------------------------------------------------------------------------------------------------------

function linkFromTo(longnameFrom,fromNamespace, longnameTo, toNameSpace, linktext, cssClass)
{
    var from = disassemble(longnameFrom, false, /\./g, fromNamespace );
    var to = disassemble(longnameTo, false, /\./g, toNameSpace );

    //find depth of equality
    var equal = true, depth = -1;
    while(equal && (depth < from.path.length))
    {
        depth++;

        if(from.path[depth] != to.path[depth])
            equal = false;
    }


    var classString = cssClass ? util.format(' class="%s"', cssClass) : '';
    var text = linktext || longnameTo;

    var url = helper.longnameToUrl[longnameTo];

    if (!url) {
        return text;
    }
    else
    {
        url = disassemble(url,true,/\./g);
        url.path = url.path.slice(depth,url.path.length);

        var link = "";
        for(var i = depth; i < from.path.length; ++i)
        {
            link +="../";
        }
        link += (url.path.length > 0 ? url.path.toString().replace(/,/g,"/")+"/" : "");

        if(toNameSpace)
        {
            link += "index.html";
        }
        else
        {
            link += url.name +"."+ url.ending;
        }

        //console.log(longnameFrom + " " +fromNamespace+ "("+from.path.length+") -> "+longnameTo+" "+ toNameSpace+"("+to.path.length+") equal: "+depth);
        //console.log("----> "+link);
        return util.format('<a href="%s"%s>%s</a>', link, classString, text);
    }
};

//----------------------------------------------------------------------------------------------------------------------

function linkFromContextTo( longnameTo, toNameSpace, linktext, cssClass)
{
    var link = "";
    if(view.api == "full")
        link = linkFromTo(view.context.longname, view.context.kind == 'namespace', longnameTo, toNameSpace, linktext, cssClass);
    else
    {
        for(var i = 0, n = view.typeLists.x3dNodes.length; i < n; ++i )
        {
            var node = view.typeLists.x3dNodes[i];
            if(node.longname == longnameTo)
            {
                var url = helper.longnameToUrl[longnameTo];
                url = disassemble(url,true,/\./g);

                var path = (node.component == view.context.component) ? "" : ("../"+node.component+"/");
                return util.format('<a href="%s">%s</a>', path+url.name+"."+url.ending, path == "" ? node.name : node.component+"/"+node.name );
            }
        }
    }
    return link;
};