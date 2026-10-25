import { runSvgEdit } from "@/lib/svg-edit";
export const runtime="nodejs";export const maxDuration=60;
export async function POST(request:Request){const token=process.env.ICON_API_TOKEN;if(token&&request.headers.get("authorization")!==`Bearer ${token}`)return Response.json({error:"Unauthorized. Configure the ICON_API_TOKEN bearer token."},{status:401});
 try{const body=await request.json() as {svg?:unknown};if(typeof body.svg!=="string")return Response.json({error:"Provide an SVG string in the svg field."},{status:400});return Response.json(await runSvgEdit(body.svg));}
 catch(error){return Response.json({error:error instanceof Error?error.message:"SVG-Edit processing failed."},{status:422});}
}