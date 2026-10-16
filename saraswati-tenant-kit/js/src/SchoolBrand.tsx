import { useSchool } from "./TenantProvider";

export function SchoolBrand({ subtitle }: { subtitle?: string }) {
  const school = useSchool();
  return (
    <div className="school-brand">
      <img src={school.logoUrl} alt="" />
      <div>
        <strong>{school.schoolName}</strong>
        {school.place ? <p>{school.place}</p> : null}
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </div>
  );
}
